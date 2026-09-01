# Changelog

## v0.2.2

[compare changes](https://github.com/agntn/forges/compare/v0.2.1...v0.2.2)

### 🚀 Enhancements

- **tui:** Improve Forges tool presentation ([#94](https://github.com/agntn/forges/pull/94))

### ❤️ Contributors

- Ori ([@oritwoen](https://github.com/oritwoen))

## v0.2.1

[compare changes](https://github.com/agntn/forges/compare/v0.2.0...v0.2.1)

### 🚀 Enhancements

- Read repository CI runs ([#86](https://github.com/agntn/forges/pull/86))
- Read pull request checks ([#87](https://github.com/agntn/forges/pull/87))
- Read pull request changed files ([#88](https://github.com/agntn/forges/pull/88))
- Read commit details and changed files ([#89](https://github.com/agntn/forges/pull/89))
- List repository commits ([#90](https://github.com/agntn/forges/pull/90))
- **pi:** Confirm pull request creation ([#91](https://github.com/agntn/forges/pull/91))
- Add repository code search ([#92](https://github.com/agntn/forges/pull/92))
- Discover contribution templates ([#93](https://github.com/agntn/forges/pull/93))

### 🩹 Fixes

- Keep generated changelog out of lint ([#85](https://github.com/agntn/forges/pull/85))

### ❤️ Contributors

- Aeitwoen <aeitwoen@gmail.com>
- Ori ([@oritwoen](https://github.com/oritwoen))

## v0.2.0

[compare changes](https://github.com/agntn/forges/compare/v0.1.2...v0.2.0)

### 🚀 Enhancements

- **errors:** Add PermissionError for 403 Forbidden responses ([#27](https://github.com/agntn/forges/pull/27))
- Add Pi and OMP extensions ([#31](https://github.com/agntn/forges/pull/31))
- Manage pull request review threads ([#32](https://github.com/agntn/forges/pull/32))
- Expose the forge tools over MCP ([#33](https://github.com/agntn/forges/pull/33))
- Read issue and pull request discussion comments ([#34](https://github.com/agntn/forges/pull/34))
- Return full user profiles ([#35](https://github.com/agntn/forges/pull/35))
- Return canonical issue and PR URLs ([#50](https://github.com/agntn/forges/pull/50))
- Include merge commit SHAs on PRs ([#56](https://github.com/agntn/forges/pull/56))
- Expose issue and pull request assignees ([#57](https://github.com/agntn/forges/pull/57))
- Assign issues and PRs during creation ([#78](https://github.com/agntn/forges/pull/78))
- Expose PR revisions and mergeability ([#79](https://github.com/agntn/forges/pull/79))
- Report repository fork and access state ([#80](https://github.com/agntn/forges/pull/80))
- Add explicit credential reload ([#81](https://github.com/agntn/forges/pull/81))
- Search repository issues by query ([#82](https://github.com/agntn/forges/pull/82))
- Query pull requests in one repository ([#83](https://github.com/agntn/forges/pull/83))

### 🔥 Performance

- Make the MCP handshake cheaper ([#45](https://github.com/agntn/forges/pull/45))

### 🩹 Fixes

- **auth:** Stop fallback chain on empty-string env token ([#25](https://github.com/agntn/forges/pull/25))
- **cache:** Replace unsafe type casts with proper types ([#28](https://github.com/agntn/forges/pull/28))
- Keep the OMP loader imports literal ([#36](https://github.com/agntn/forges/pull/36))
- Include private repos for organization owners ([#41](https://github.com/agntn/forges/pull/41))
- Bound comment bodies in list results ([#42](https://github.com/agntn/forges/pull/42))
- Reject a comment id from another issue ([#43](https://github.com/agntn/forges/pull/43))
- Pin the account the tools write as ([#44](https://github.com/agntn/forges/pull/44))
- Let public reads run without auth ([#58](https://github.com/agntn/forges/pull/58))
- Bypass cache for issue and PR reads ([#70](https://github.com/agntn/forges/pull/70))
- Keep full list bodies out of details ([#73](https://github.com/agntn/forges/pull/73))
- Make lint inspect the source tree ([#75](https://github.com/agntn/forges/pull/75))
- Stop serving stale comments and users ([#76](https://github.com/agntn/forges/pull/76))
- Recover reads after credentials appear ([#77](https://github.com/agntn/forges/pull/77))

### 💅 Refactors

- ⚠️  Make Provider an abstract class ([#29](https://github.com/agntn/forges/pull/29))

### 🏡 Chore

- Add .js extensions to relative imports in gitea provider ([#26](https://github.com/agntn/forges/pull/26))
- ⚠️  Rebrand as @agntn/forges ([#30](https://github.com/agntn/forges/pull/30))

### 🤖 CI

- Reject formatter drift before build ([#55](https://github.com/agntn/forges/pull/55))
- Replace npm release token with OIDC ([#84](https://github.com/agntn/forges/pull/84))

#### ⚠️ Breaking Changes

- ⚠️  Make Provider an abstract class ([#29](https://github.com/agntn/forges/pull/29))
- ⚠️  Rebrand as @agntn/forges ([#30](https://github.com/agntn/forges/pull/30))

### ❤️ Contributors

- Ori ([@oritwoen](https://github.com/oritwoen))
- Aeitwoen <aeitwoen@gmail.com>

## v0.1.2

[compare changes](https://github.com/agntn/forges/compare/v0.1.1...v0.1.2)

### 🚀 Enhancements

- Export cache management functions from public API ([#18](https://github.com/agntn/forges/pull/18))

### 🩹 Fixes

- **http:** Skip empty token auth ([#2](https://github.com/agntn/forges/pull/2))
- **cache:** Normalize query keys ([#4](https://github.com/agntn/forges/pull/4))
- Normalize self-hosted GitLab and Gitea base URLs ([#5](https://github.com/agntn/forges/pull/5))
- Bound GitLab project ID cache ([#11](https://github.com/agntn/forges/pull/11))
- Validate Retry-After header before passing to RateLimitError ([#14](https://github.com/agntn/forges/pull/14))
- Set auth header on options.headers instead of request.headers ([#21](https://github.com/agntn/forges/pull/21))
- Use glab config get token for GitLab CLI detection ([#22](https://github.com/agntn/forges/pull/22))
- Harden pagination safety guards ([#12](https://github.com/agntn/forges/pull/12))
- Let paginate() accept custom per-page param name ([#15](https://github.com/agntn/forges/pull/15))
- Throw GixaError subtypes from createProvider ([#16](https://github.com/agntn/forges/pull/16))
- Sync default user agent with package version ([#20](https://github.com/agntn/forges/pull/20))
- Pass draft flag in GitLab merge request creation ([#17](https://github.com/agntn/forges/pull/17))
- Prefer GH_TOKEN over GITHUB_TOKEN in env detection ([#19](https://github.com/agntn/forges/pull/19))

### 📖 Documentation

- Add runnable API usage examples ([#13](https://github.com/agntn/forges/pull/13))

### 🏡 Chore

- Add AGENTS.md ([0f9a0b0](https://github.com/agntn/forges/commit/0f9a0b0))
- Update README.md ([4e20d59](https://github.com/agntn/forges/commit/4e20d59))
- Update AGENTS.md ([ca963cf](https://github.com/agntn/forges/commit/ca963cf))
- Update README.md ([6fff5e1](https://github.com/agntn/forges/commit/6fff5e1))
- Add oxlint and oxfmt ([#7](https://github.com/agntn/forges/pull/7))

### ❤️ Contributors

- Ori ([@oritwoen](https://github.com/oritwoen))
- Oritwoen ([@oritwoen](https://github.com/oritwoen))

## v0.1.1
