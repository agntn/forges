import { createProvider } from "@agntn/forges";

async function main(): Promise<void> {
  const github = createProvider("github");

  const repos = await github.repos.list("unjs", { perPage: 5 });
  console.log(
    "repos",
    repos.items.map((repo) => repo.fullName),
  );

  const firstRepo = repos.items[0];
  if (firstRepo) {
    const issues = await github.issues.list(firstRepo.owner.login, firstRepo.name, {
      state: "open",
      perPage: 3,
    });
    console.log(
      "issues",
      issues.items.map((issue) => issue.title),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
