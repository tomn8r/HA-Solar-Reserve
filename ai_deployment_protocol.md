# AI Deployment Protocol: HA Solar Reserve

This document is a **Skill File** for Antigravity AI agents. It defines the strict operational procedure for releasing updates to this repository.

## 1. Audit Phase
Before committing, the agent must:
- Run `git status` and `git diff` to summarize all changes since the last version.
- **MANDATORY:** Verify that the directory name inside `custom_components/` matches exactly the `DOMAIN` variable in `custom_components/*/const.py`.
- Ensure no sensitive information (API keys, personal IPs) is in the code.
- Verify that `custom_components/solar_reserve/frontend/solar-reserve-panel.js` is updated if UI changes were made.

## 2. Semantic Versioning (SemVer)
The agent must determine the increment level based on the audit:
- **BETA** (0.0.0-beta.x): Pre-release hardening/testing for new major/minor features.
- **PATCH** (0.0.1): Logic hardening, bug fixes, performance optimizations, or documentation tweaks.
- **MINOR** (0.1.0): New diagnostic sensors, new Dashboard features (buttons, tooltips), or new configuration options.
- **MAJOR** (1.0.0): Breaking changes to entity IDs, removal of core features, or major architectural shifts that require user intervention.

## 3. Update Phase
The agent must perform the following modifications:
1.  **manifest.json:** Update the `"version"` field to the new SemVer string.
2.  **readme.md:**
    - Update the "Features" or "Exposed Sensors" list if applicable.
    - (Optional) Append a timestamped entry to the `# Changelog` section at the end of the file.

## 4. Verification Phase
- Run a JSON validation check on `manifest.json`.
- Check `coordinator.py` for any orphaned variables created during the logic update.

## 5. Synchronization Phase (Git)
The agent should execute the following sequence:
1.  `git add .`
2.  `git commit -m "Release vX.X.X: [Brief Summary of primary change]"`
3.  `git tag -a vX.X.X -m "Version X.X.X"`
4.  `git push origin master --follow-tags`

---
*Authorized Instruction: Any Antigravity agent directed to "perform a release" should load this file and follow the steps above.*
