import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { registerPiTools, type PiConfirm, type PiRenderers } from "@agntn/tools/pi";

import type * as ForgesTools from "../../../dist/tool-operations.d.mts";
import type * as ForgesToolList from "../../../dist/tools.d.mts";
import {
  type RenderedToolResult,
  type RenderOptions,
  renderToolCall,
  renderToolResult,
  type StatusTheme,
} from "../../shared/tui.ts";
import { lazy } from "../../shared/lazy.ts";

const platformLabels: Record<ForgesTools.ForgesPlatform, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
};
// oxlint-disable-next-line eslint/no-control-regex -- Removing terminal control bytes is intentional.
const controlCharacter = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;
const formatOrLineSeparator = /[\p{Cf}\p{Zl}\p{Zp}]/gu;
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** The adapter keeps lone surrogates and glues words around a stripped escape, so clean first. */
function sanitizeApprovalText(value: string): string {
  const separated = value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\u001B", " \u001B")
    .replaceAll("\u009B", " \u009B")
    .replaceAll("\u009D", " \u009D");
  return stripVTControlCharacters(separated)
    .replace(controlCharacter, " ")
    .replace(formatOrLineSeparator, " ")
    .replace(loneSurrogate, " ");
}

function approvalField(value: string): string {
  return sanitizeApprovalText(value).replaceAll("\n", " ");
}

/** A write that names its account shows it; without one it goes out as the pinned credential. */
function accountLine(account: string | undefined): string[] {
  return account === undefined ? [] : [`Account     ${approvalField(account)}`];
}

/** The approval text names the resolved target, so the dialog matches the write. */
type Resolved<P extends ForgesTools.RepositoryParams> = P & ForgesTools.RepositoryTarget;

function pullRequestApprovalMessage(params: Resolved<ForgesTools.CreatePullRequestParams>): string {
  const body = sanitizeApprovalText(params.body);
  return [
    `Repository  ${approvalField(params.owner)}/${approvalField(params.repo)} on ${platformLabels[params.platform]}`,
    ...accountLine(params.account),
    `Branches    ${approvalField(params.sourceBranch)} → ${approvalField(params.targetBranch)}`,
    `Status      ${params.draft === true ? "Draft" : "Ready for review"}`,
    `Assignees   ${params.assignees?.map(approvalField).join(", ") || "None"}`,
    "",
    "Title",
    approvalField(params.title),
    "",
    "Description",
    body || "(none)",
  ].join("\n");
}

/** On a create an omitted flag is the platform default; on an update it stays as it is. */
function releaseApprovalMessage(
  params: Resolved<ForgesTools.CreateReleaseParams> | Resolved<ForgesTools.UpdateReleaseParams>,
  creating: boolean,
): string {
  const flag = (value: boolean | undefined, on: string, off: string) =>
    value === undefined && !creating ? "Unchanged" : value === true ? on : off;
  const text = (value: string | undefined, clean: (value: string) => string) =>
    value === undefined ? (creating ? "(none)" : "(unchanged)") : clean(value) || "(none)";
  const target =
    "ref" in params && params.ref !== undefined ? ` (from ${approvalField(params.ref)})` : "";
  return [
    `Repository  ${approvalField(params.owner)}/${approvalField(params.repo)} on ${platformLabels[params.platform]}`,
    ...accountLine(params.account),
    `Tag         ${approvalField(params.tag)}${target}`,
    `Draft       ${flag(params.draft, "Yes", "No, public at once")}`,
    `Pre-release ${flag(params.prerelease, "Yes", "No")}`,
    "",
    "Title",
    text(params.name, approvalField),
    "",
    "Notes",
    text(params.body, sanitizeApprovalText),
  ].join("\n");
}

/** An update lists only what it changes; everything else stays as it is. */
function updateApprovalMessage(params: Resolved<ForgesTools.UpdateIssueParams>): string {
  const changes = (added: string[] | undefined, removed: string[] | undefined) =>
    [
      ...(added ?? []).map((value) => `+${approvalField(value)}`),
      ...(removed ?? []).map((value) => `-${approvalField(value)}`),
    ].join(", ") || "Unchanged";
  const state =
    params.state === undefined ? "Unchanged" : params.state === "closed" ? "Close" : "Reopen";
  return [
    `Repository  ${approvalField(params.owner)}/${approvalField(params.repo)} on ${platformLabels[params.platform]}`,
    ...accountLine(params.account),
    `Number      #${params.number}`,
    `State       ${state}`,
    `Assignees   ${changes(params.addAssignees, params.removeAssignees)}`,
    `Labels      ${changes(params.addLabels, params.removeLabels)}`,
    "",
    "Title",
    params.title === undefined ? "(unchanged)" : approvalField(params.title),
    "",
    "Description",
    params.body === undefined ? "(unchanged)" : sanitizeApprovalText(params.body) || "(none)",
  ].join("\n");
}

function mergeApprovalMessage(params: Resolved<ForgesTools.MergePullRequestParams>): string {
  return [
    `Repository  ${approvalField(params.owner)}/${approvalField(params.repo)} on ${platformLabels[params.platform]}`,
    ...accountLine(params.account),
    `Number      #${params.number}`,
    `Method      ${params.method === undefined ? "Platform default" : approvalField(params.method)}`,
    `Head        ${params.headSha === undefined ? "Any" : approvalField(params.headSha)}`,
    "",
    "Commit title",
    params.title === undefined ? "(platform default)" : approvalField(params.title),
    "",
    "Commit message",
    params.message === undefined
      ? "(platform default)"
      : sanitizeApprovalText(params.message) || "(none)",
  ].join("\n");
}

/** Current source in development, the built package in distributions. */
function fromCheckout(module: string): string {
  const source = new URL(`../../../src/${module}.ts`, import.meta.url);
  return existsSync(fileURLToPath(source))
    ? source.href
    : new URL(`../../../dist/${module}.mjs`, import.meta.url).href;
}

/** Only the approval dialogs need it: the target they name is the one the write goes to. */
const loadToolOperations = /* @__PURE__ */ lazy(
  async () => (await import(fromCheckout("tool-operations"))) as typeof ForgesTools,
);

/** The target the write goes to; the adapter already checked the input against the schema. */
async function resolved<P extends ForgesTools.RepositoryParams>(
  input: unknown,
): Promise<Resolved<P>> {
  return (await loadToolOperations()).repositoryTarget(input as P);
}

/** These writes go public or overwrite public text, so Pi asks before each one. */
const confirm: Record<string, PiConfirm> = {
  forges_releases_create: async (input) => ({
    title: "Create release?",
    message: releaseApprovalMessage(await resolved<ForgesTools.CreateReleaseParams>(input), true),
  }),
  forges_releases_update: async (input) => ({
    title: "Update release?",
    message: releaseApprovalMessage(await resolved<ForgesTools.UpdateReleaseParams>(input), false),
  }),
  forges_issues_update: async (input) => ({
    title: "Update issue?",
    message: updateApprovalMessage(await resolved<ForgesTools.UpdateIssueParams>(input)),
  }),
  forges_pull_requests_create: async (input) => ({
    title: "Create pull request?",
    message: pullRequestApprovalMessage(await resolved<ForgesTools.CreatePullRequestParams>(input)),
  }),
  forges_pull_requests_update: async (input) => ({
    title: "Update pull request?",
    message: updateApprovalMessage(await resolved<ForgesTools.UpdatePullRequestParams>(input)),
  }),
  forges_pull_requests_merge: async (input) => ({
    title: "Merge pull request?",
    message: mergeApprovalMessage(await resolved<ForgesTools.MergePullRequestParams>(input)),
  }),
};

function statusRenderers(name: string, title: string): PiRenderers {
  return {
    renderCall(args: unknown, theme: StatusTheme, context: RenderOptions) {
      return new Text(renderToolCall(name, title, args, context, theme), 0, 0);
    },
    renderResult(
      result: RenderedToolResult,
      options: RenderOptions,
      theme: StatusTheme,
      context?: Readonly<{ isError?: boolean }>,
    ) {
      return new Text(
        renderToolResult(name, result, context?.isError === true, options, theme),
        0,
        0,
      );
    },
  };
}

/** Registers the forges tools, with their status lines and the six approval dialogs. */
export default async function forgesExtension(pi: ExtensionAPI): Promise<void> {
  const { forgesTools } = (await import(fromCheckout("tools"))) as typeof ForgesToolList;
  const tools = forgesTools();
  registerPiTools(pi, tools, {
    renderers: Object.fromEntries(
      tools.map((tool) => [tool.name, statusRenderers(tool.name, tool.title)]),
    ),
    confirm,
  });
}
