# Changelog

## [1.5.1](https://github.com/chrischall/canvas-parent-mcp/compare/v1.5.0...v1.5.1) (2026-09-01)


### Bug Fixes

* **mint:** drop CANVAS_ACCESS_TOKEN — the variable is inert ([#161](https://github.com/chrischall/canvas-parent-mcp/issues/161)) ([7066efa](https://github.com/chrischall/canvas-parent-mcp/commit/7066efaa17b6d90ab7a92ab2d124e39fa27c9b11))


### Documentation

* **mint:** declare CANVAS_ACCESS_TOKEN in mint.yaml ([#158](https://github.com/chrischall/canvas-parent-mcp/issues/158)) ([3851dbd](https://github.com/chrischall/canvas-parent-mcp/commit/3851dbd32b1aaabc3e79741218cc25359cb692bd))

## [1.5.0](https://github.com/chrischall/canvas-parent-mcp/compare/v1.4.0...v1.5.0) (2026-08-30)


### Features

* add canvas_healthcheck, registered even when unconfigured ([#149](https://github.com/chrischall/canvas-parent-mcp/issues/149)) ([5db8b59](https://github.com/chrischall/canvas-parent-mcp/commit/5db8b59cbc4b8b0d49e81644dd3c21fd2aace860))

## [1.4.0](https://github.com/chrischall/canvas-parent-mcp/compare/v1.3.1...v1.4.0) (2026-08-29)


### Features

* **deps:** take @fetchproxy/server 2.2.0 so the concentrator can bind its sandbox address ([#147](https://github.com/chrischall/canvas-parent-mcp/issues/147)) ([f5e14ec](https://github.com/chrischall/canvas-parent-mcp/commit/f5e14ec8ccd541fb67a4960f595d4f70ef31e17f))

## [1.3.1](https://github.com/chrischall/canvas-parent-mcp/compare/v1.3.0...v1.3.1) (2026-08-28)


### Bug Fixes

* **egress:** declare every host the server dials in mint.yaml ([#145](https://github.com/chrischall/canvas-parent-mcp/issues/145)) ([d755152](https://github.com/chrischall/canvas-parent-mcp/commit/d7551528b0724c71f01a4fa2217fa3093bb061c4))

## [1.3.0](https://github.com/chrischall/canvas-parent-mcp/compare/v1.2.5...v1.3.0) (2026-08-28)


### Features

* cache the signed-in session so a restart skips authenticating ([#137](https://github.com/chrischall/canvas-parent-mcp/issues/137)) ([f9a6c11](https://github.com/chrischall/canvas-parent-mcp/commit/f9a6c1152539af27af5494b0c210a10205b53c0f))


### Documentation

* list the cache env vars in server.json and .env.example ([#143](https://github.com/chrischall/canvas-parent-mcp/issues/143)) ([0a368f7](https://github.com/chrischall/canvas-parent-mcp/commit/0a368f7a6eedbc82ae0acc86e5db5f2f1aa0bb14))
* list the session-cache vars in the Environment block ([#144](https://github.com/chrischall/canvas-parent-mcp/issues/144)) ([51b97f2](https://github.com/chrischall/canvas-parent-mcp/commit/51b97f26ddb0b18f736895322eb7c778a1307f5b))
* npm test now typechecks before running vitest ([#141](https://github.com/chrischall/canvas-parent-mcp/issues/141)) ([d999f6e](https://github.com/chrischall/canvas-parent-mcp/commit/d999f6e136c1c074a32606939bbb90e90a045738))
* **skill:** declare the name this skill actually publishes under ([#135](https://github.com/chrischall/canvas-parent-mcp/issues/135)) ([e574590](https://github.com/chrischall/canvas-parent-mcp/commit/e5745904508a86cbd457538ea41ff6167e503803))

## [1.2.5](https://github.com/chrischall/canvas-parent-mcp/compare/v1.2.4...v1.2.5) (2026-08-06)


### Bug Fixes

* **deps:** move to @fetchproxy/server 2.0.0 for the v3 handshake ([#122](https://github.com/chrischall/canvas-parent-mcp/issues/122)) ([fa781e3](https://github.com/chrischall/canvas-parent-mcp/commit/fa781e3508a695c751b34bf3497e6792f54c76ea))

## [1.2.4](https://github.com/chrischall/canvas-parent-mcp/compare/v1.2.3...v1.2.4) (2026-08-03)


### Bug Fixes

* **auth:** lift cookies from the tenant subdomain, not the wildcard apex ([#114](https://github.com/chrischall/canvas-parent-mcp/issues/114)) ([cd570b8](https://github.com/chrischall/canvas-parent-mcp/commit/cd570b8e4b6916f5cf91a9820c0a09d0429f0428))


### Refactor

* **auth:** rename liftersByDomain to match its actual key ([#116](https://github.com/chrischall/canvas-parent-mcp/issues/116)) ([8970c18](https://github.com/chrischall/canvas-parent-mcp/commit/8970c18fffddb6eee8e55b29c5106eb3e5a8f004)), closes [#115](https://github.com/chrischall/canvas-parent-mcp/issues/115)

## [1.2.3](https://github.com/chrischall/canvas-parent-mcp/compare/v1.2.2...v1.2.3) (2026-08-03)


### Bug Fixes

* **auth:** renew the browser session instead of treating a 401 as terminal ([#108](https://github.com/chrischall/canvas-parent-mcp/issues/108)) ([665d989](https://github.com/chrischall/canvas-parent-mcp/commit/665d9892825d9fb5e2bfdde4f495413f94094246))


### Refactor

* **auth:** collapse the hand-rolled lifter onto createSessionLifter ([#111](https://github.com/chrischall/canvas-parent-mcp/issues/111)) ([16d8e5e](https://github.com/chrischall/canvas-parent-mcp/commit/16d8e5ea60dd7b137a596fd7e66a4a63b865ba72))

## [1.2.2](https://github.com/chrischall/canvas-parent-mcp/compare/v1.2.1...v1.2.2) (2026-07-30)


### Bug Fixes

* **deps:** bump @fetchproxy/* to 1.7.0 and @chrischall/mcp-utils to 0.14.0 ([#103](https://github.com/chrischall/canvas-parent-mcp/issues/103)) ([14fa43c](https://github.com/chrischall/canvas-parent-mcp/commit/14fa43c29d574ee0a2eea7bea10b4801af6aea9a))

## [1.2.1](https://github.com/chrischall/canvas-parent-mcp/compare/v1.2.0...v1.2.1) (2026-07-19)


### Documentation

* replace duplicated fleet policy with a pointer ([#96](https://github.com/chrischall/canvas-parent-mcp/issues/96)) ([a44de7b](https://github.com/chrischall/canvas-parent-mcp/commit/a44de7b72b2184094c6c9f1561c73b43b86b585c))

## [1.2.0](https://github.com/chrischall/canvas-parent-mcp/compare/v1.1.8...v1.2.0) (2026-07-13)


### Features

* **skill:** add canvas-parent api access skill ([#92](https://github.com/chrischall/canvas-parent-mcp/issues/92)) ([effd88f](https://github.com/chrischall/canvas-parent-mcp/commit/effd88fc00d14efd33638fd8eeb4bb155cb7c1c2)), closes [#93](https://github.com/chrischall/canvas-parent-mcp/issues/93)


### Refactor

* **skill:** move root SKILL.md into skills/, point plugin.json at ./skills/ ([#94](https://github.com/chrischall/canvas-parent-mcp/issues/94)) ([9e1061c](https://github.com/chrischall/canvas-parent-mcp/commit/9e1061ce4e0c4813dede062c0f4b0d17d41ebfe7))

## [1.1.8](https://github.com/chrischall/canvas-parent-mcp/compare/v1.1.7...v1.1.8) (2026-07-07)


### Bug Fixes

* bump @chrischall/mcp-utils to 0.12.0 ([#88](https://github.com/chrischall/canvas-parent-mcp/issues/88)) ([63a725e](https://github.com/chrischall/canvas-parent-mcp/commit/63a725e506f87a4a8f6eef5d6644797477bd514e))


### Refactor

* adopt shared CookieJar and createOAuth2Refresher from mcp-utils ([#85](https://github.com/chrischall/canvas-parent-mcp/issues/85)) ([db5b87f](https://github.com/chrischall/canvas-parent-mcp/commit/db5b87fa9ef00ab6964f1b151a3de2ec2d738dae))

## [1.1.7](https://github.com/chrischall/canvas-parent-mcp/compare/v1.1.6...v1.1.7) (2026-07-05)


### Documentation

* fix auth priority order + add auto-review follow-up convention ([#75](https://github.com/chrischall/canvas-parent-mcp/issues/75)) ([f1cc979](https://github.com/chrischall/canvas-parent-mcp/commit/f1cc9794141b3688d59e02637e5bb1075fb3d287))
* fix auth.ts precedence comments to match loadAccount order ([#76](https://github.com/chrischall/canvas-parent-mcp/issues/76)) ([6ad6b49](https://github.com/chrischall/canvas-parent-mcp/commit/6ad6b49ae6fb2d07e0a188593508a523dbf25730))
* require Conventional Commit PR titles for release-please ([#71](https://github.com/chrischall/canvas-parent-mcp/issues/71)) ([37a6584](https://github.com/chrischall/canvas-parent-mcp/commit/37a6584701bfb33ba6f95d2bd14aae4e99dc17cc))

## [1.1.6](https://github.com/chrischall/canvas-parent-mcp/compare/v1.1.5...v1.1.6) (2026-06-13)


### Bug Fixes

* bot PRs bypass the CI gate unconditionally (upstream curtaincall[#86](https://github.com/chrischall/canvas-parent-mcp/issues/86) review) ([#67](https://github.com/chrischall/canvas-parent-mcp/issues/67)) ([ce9a800](https://github.com/chrischall/canvas-parent-mcp/commit/ce9a800a39ce3fa36bd2b5908b31e7739896614d))


### Documentation

* add MIT LICENSE file and README badges ([#65](https://github.com/chrischall/canvas-parent-mcp/issues/65)) ([cf46e99](https://github.com/chrischall/canvas-parent-mcp/commit/cf46e99d5512c3230fc88e0f4a66720d6bd3c2e4))
* correct release flow to describe release-please ([#63](https://github.com/chrischall/canvas-parent-mcp/issues/63)) ([f9587e5](https://github.com/chrischall/canvas-parent-mcp/commit/f9587e50175d42a93f7b6b706a4e5a76330edc20))

## [1.1.5](https://github.com/chrischall/canvas-parent-mcp/compare/v1.1.4...v1.1.5) (2026-06-04)


### Bug Fixes

* adopt @fetchproxy/server 0.13.0 (bridge host failover + re-pairing) ([#55](https://github.com/chrischall/canvas-parent-mcp/issues/55)) ([f3f1dc0](https://github.com/chrischall/canvas-parent-mcp/commit/f3f1dc0d6029db4693f1a6c3142e0e26b1c1b2b9))
* adopt @fetchproxy/server 1.0.0 + @chrischall/mcp-utils 0.5.0 ([#57](https://github.com/chrischall/canvas-parent-mcp/issues/57)) ([b34c774](https://github.com/chrischall/canvas-parent-mcp/commit/b34c7748687f89e4e9af8c550fc4792bf86b0e4a))

## [1.1.4](https://github.com/chrischall/canvas-parent-mcp/compare/v1.1.3...v1.1.4) (2026-05-29)


### Bug Fixes

* **ci:** auto-merge arm guards ([#42](https://github.com/chrischall/canvas-parent-mcp/issues/42)) ([682e2ef](https://github.com/chrischall/canvas-parent-mcp/commit/682e2ef663d9a267e2d0d093bbeb24c674cee7dc))

## [1.1.3](https://github.com/chrischall/canvas-parent-mcp/compare/v1.1.2...v1.1.3) (2026-05-26)


### Documentation

* **claude:** warn against early PRs and call out first-party dep bumps ([#38](https://github.com/chrischall/canvas-parent-mcp/issues/38)) ([a425ab3](https://github.com/chrischall/canvas-parent-mcp/commit/a425ab34be64a474ba61153da76148d213ebf69d))

## [1.1.2](https://github.com/chrischall/canvas-parent-mcp/compare/v1.1.1...v1.1.2) (2026-05-26)


### Bug Fixes

* **ci:** replace ofw-mcp references with canvas-parent-mcp in release workflow ([#35](https://github.com/chrischall/canvas-parent-mcp/issues/35)) ([18a18bb](https://github.com/chrischall/canvas-parent-mcp/commit/18a18bbfbe1838653c4d8fc278adbf1ccada3be5))

## [1.1.1](https://github.com/chrischall/canvas-parent-mcp/compare/v1.1.0...v1.1.1) (2026-05-25)


### Bug Fixes

* **ci:** prevent labeled event from cancelling auto-review ([#33](https://github.com/chrischall/canvas-parent-mcp/issues/33)) ([d453a8b](https://github.com/chrischall/canvas-parent-mcp/commit/d453a8b9f1550c75b709885bd097c53cff458076))

## [1.1.0](https://github.com/chrischall/canvas-parent-mcp/compare/v1.0.4...v1.1.0) (2026-05-24)


### Features

* @fetchproxy/bootstrap as a fourth auth path ([12bdfb6](https://github.com/chrischall/canvas-parent-mcp/commit/12bdfb6347c7b7093905626b47bfce61f70825fa))
* @fetchproxy/bootstrap as a fourth auth path ([c26e808](https://github.com/chrischall/canvas-parent-mcp/commit/c26e8086e8b683d52fc2141b289b4fbd12edcfbb))
* **auth:** add QR-login, password-login, and auto-renew bootstraps ([c75f79b](https://github.com/chrischall/canvas-parent-mcp/commit/c75f79b9b51febc32d16b8aa318542dc65d5e188))


### Bug Fixes

* **bundle:** add createRequire shim so ws works in ESM bundle ([495ca72](https://github.com/chrischall/canvas-parent-mcp/commit/495ca72656d838400cf67a446a84247f190eac7e))
* **bundle:** add createRequire shim so ws works in ESM bundle ([d02dff0](https://github.com/chrischall/canvas-parent-mcp/commit/d02dff01bbabc4e64610f03ff5cb5e3775cb3323))
* **ci:** test mock factory + drop dead client branch ([4610574](https://github.com/chrischall/canvas-parent-mcp/commit/4610574a98db74d20aceb61114f84474167df4cf))
* **config:** also reject literal "undefined"/"null" in readVar ([9676912](https://github.com/chrischall/canvas-parent-mcp/commit/9676912996ad3d10d4e76407fe1b9841bff90dc5))
* **config:** treat blank/whitespace/unsubstituted-placeholder env vars as unset ([61a57c6](https://github.com/chrischall/canvas-parent-mcp/commit/61a57c6798ea3b8bc79df6cc3a90764011ff0fc9))
* don't crash at install when env vars are missing; trim .mcpb ([b8504d6](https://github.com/chrischall/canvas-parent-mcp/commit/b8504d6f1f8ab35c41cba0900be6d7a6345453e9))
* don't crash at install when env vars are missing; trim .mcpb ([651407b](https://github.com/chrischall/canvas-parent-mcp/commit/651407b163325405cb16a825fded2820e9fd5288))
* **server.json:** shorten description under MCP Registry's 100-char cap ([6290284](https://github.com/chrischall/canvas-parent-mcp/commit/62902840f390f5497d1f4fe274844277c004b0ea))


### Reverts

* restore .gitignore + npm ci workflows ([f699c18](https://github.com/chrischall/canvas-parent-mcp/commit/f699c183ee9505198d3ea70cf463c037b3dc6f99))


### Refactor

* **auth:** drop CANVAS_COOKIE in favor of u/p auto-login ([d5631ba](https://github.com/chrischall/canvas-parent-mcp/commit/d5631babe9e19124852d16c3be1b77f80fd8528e))
* **client:** factor 401 retry into authedFetch; fix download silent expiry ([69be099](https://github.com/chrischall/canvas-parent-mcp/commit/69be09935aa35b98b57fa11547466c98a66657e6))
* **session-login:** drop unused baseUrl from SessionLoginResult ([e669fa4](https://github.com/chrischall/canvas-parent-mcp/commit/e669fa413d1a57e38f865011b27e582f249403d8))


### Documentation

* add Acknowledgement of Terms section to README ([#27](https://github.com/chrischall/canvas-parent-mcp/issues/27)) ([b7131bc](https://github.com/chrischall/canvas-parent-mcp/commit/b7131bc7f19993acc14f2c68a2a3552651e365da))
* **auth:** make username/password the recommended mode ([9a408ab](https://github.com/chrischall/canvas-parent-mcp/commit/9a408abe5215930aeb0f87634edcd261b3bc0b6a))
* canonical auto-merge guidance ([#28](https://github.com/chrischall/canvas-parent-mcp/issues/28)) ([f67d1cc](https://github.com/chrischall/canvas-parent-mcp/commit/f67d1cc18c0dc4aa37e57eb5e43f71c9493eeb10))
* **claude-md:** call out 100-char limit on server.json description ([#23](https://github.com/chrischall/canvas-parent-mcp/issues/23)) ([8477599](https://github.com/chrischall/canvas-parent-mcp/commit/8477599827a282e7d964936710878c42113379c5))
* **CLAUDE.md:** drop hardcoded fetchproxy 0.3.0 version refs ([df9e156](https://github.com/chrischall/canvas-parent-mcp/commit/df9e15614a49000f41224adb43ce58272a44add0))
* **CLAUDE.md:** drop hardcoded fetchproxy 0.3.0 version refs ([e502be7](https://github.com/chrischall/canvas-parent-mcp/commit/e502be7f800cbf541460c078b0bb7e59e1a13129))
* ensure CLAUDE.md is current and complete ([a97d24d](https://github.com/chrischall/canvas-parent-mcp/commit/a97d24d46cf92ed94ed82ffbcf480acb67cd68cf))
* ensure CLAUDE.md is current and complete ([37fdfbb](https://github.com/chrischall/canvas-parent-mcp/commit/37fdfbb627a171079587dbb002a8795c9e72ef65))
