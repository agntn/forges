# Changelog

## v0.1.2

[compare changes](https://github.com/oritwoen/gixa/compare/v0.1.1...v0.1.2)

### 🚀 Enhancements

- Export cache management functions from public API ([#18](https://github.com/oritwoen/gixa/pull/18))

### 🩹 Fixes

- **http:** Skip empty token auth ([#2](https://github.com/oritwoen/gixa/pull/2))
- **cache:** Normalize query keys ([#4](https://github.com/oritwoen/gixa/pull/4))
- Normalize self-hosted GitLab and Gitea base URLs ([#5](https://github.com/oritwoen/gixa/pull/5))
- Bound GitLab project ID cache ([#11](https://github.com/oritwoen/gixa/pull/11))
- Validate Retry-After header before passing to RateLimitError ([#14](https://github.com/oritwoen/gixa/pull/14))
- Set auth header on options.headers instead of request.headers ([#21](https://github.com/oritwoen/gixa/pull/21))
- Use glab config get token for GitLab CLI detection ([#22](https://github.com/oritwoen/gixa/pull/22))
- Harden pagination safety guards ([#12](https://github.com/oritwoen/gixa/pull/12))
- Let paginate() accept custom per-page param name ([#15](https://github.com/oritwoen/gixa/pull/15))
- Throw GixaError subtypes from createProvider ([#16](https://github.com/oritwoen/gixa/pull/16))
- Sync default user agent with package version ([#20](https://github.com/oritwoen/gixa/pull/20))
- Pass draft flag in GitLab merge request creation ([#17](https://github.com/oritwoen/gixa/pull/17))
- Prefer GH_TOKEN over GITHUB_TOKEN in env detection ([#19](https://github.com/oritwoen/gixa/pull/19))

### 📖 Documentation

- Add runnable API usage examples ([#13](https://github.com/oritwoen/gixa/pull/13))

### 🏡 Chore

- Add AGENTS.md ([0f9a0b0](https://github.com/oritwoen/gixa/commit/0f9a0b0))
- Update README.md ([4e20d59](https://github.com/oritwoen/gixa/commit/4e20d59))
- Update AGENTS.md ([ca963cf](https://github.com/oritwoen/gixa/commit/ca963cf))
- Update README.md ([6fff5e1](https://github.com/oritwoen/gixa/commit/6fff5e1))
- Add oxlint and oxfmt ([#7](https://github.com/oritwoen/gixa/pull/7))

### ❤️ Contributors

- Ori ([@oritwoen](https://github.com/oritwoen))
- Oritwoen ([@oritwoen](https://github.com/oritwoen))

## v0.1.1
