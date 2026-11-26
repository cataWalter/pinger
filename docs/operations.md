# Pinger Operations

## Local Data Retention

Matrix end-to-end encryption protects messages in transit. Pinger can cache decrypted messages and media on this device. Use OS disk encryption for protection at rest and a separate OS user profile on shared machines.

| Data | Current behavior |
| --- | --- |
| Matrix database, session, and encryption keys | Successful logout terminates the Matrix session and removes the account database, associated WAL files, and pickle key. Export room keys with a passphrase before disconnecting a verified session if a recovery copy is needed. |
| Media cache | Settings > Storage can remove cached media without deleting messages or keys. Logging out alone does not clear the cache. Files saved to Downloads or other folders are separate. |
| Drafts | Turn off **Keep unsent drafts after restarting** to remove persisted composer drafts. Staged attachments and volatile AI drafts are kept only during the app session. |
| Preferences and scheduled jobs | Legacy-account cleanup removes persisted preferences and jobs belonging to obsolete account IDs. Logout is not a full profile reset. Review or cancel pending sends and reminders before signing into a different Matrix identity on the same profile. |
| Standalone AI history and provider credentials | Delete standalone chats in the AI workspace. Clear online provider keys in Settings > AI; the keychain entry is tied to the endpoint's host. Changing provider or revoking consent does not delete history, keys, or prior requests at the provider. |
| Exports and backups | Exported text, media, and encrypted room-key files are separate copies in the chosen location. Later deletion in Pinger does not remove those copies. A chat export is not a restorable Matrix database backup. |

## Diagnostics And Performance

- Start a test build with `PINGER_LOG_LEVEL=debug` to see structured duration and outcome fields for sync startup, scheduled delivery, and AI completion. The timing events exclude message text, prompts, access tokens, and endpoint URLs. Other native or dependency logs can contain local paths or server details; inspect and redact before sharing them.
- After a Go binding change, run `wails3 generate bindings -f '-tags sqlite_fts5,goolm' -clean=true -ts -i` and rebuild both the frontend and native process. The bindings are generated locally and in CI.
- Use `npm --prefix frontend run bench -- --run` for the synthetic 5,000-message merge and 1,000-room reconciliation benchmarks. Use `go test -tags 'sqlite_fts5 goolm' ./matrix -run '^$' -bench BenchmarkSearchTimelineCursors -benchmem` for the 50-result SQLite cursor fixture. The fixtures need no production account.
- For startup, history prepend, and memory comparisons, use the same test profile, app version, platform, window size, and zoom before and after a change. Record cold and warm starts separately and capture multiple runs. Do not copy real message stores into benchmark artifacts.

## Releases

Push a protected `vMAJOR.MINOR` or `vMAJOR.MINOR.PATCH` tag for a stable release. Prefer a build-only dispatch first. The publish job verifies SHA-256 checksums and generates GitHub build provenance for the final packages; verify a downloaded file with `gh attestation verify <asset> --repo cataWalter/pinger`. Keep AGPL source and notices available with distributions.

The packaged startup gate runs the actual executable with `--smoke-test` and an isolated application data directory. It requires the embedded frontend to reach the native Wails startup binding. It does not sign in, modify real chat data, or validate native notifications. To run it locally, launch the executable inside a built bundle or package with that argument and check that it prints `Pinger packaged startup smoke passed`.

### Native Acceptance Before A Public Release

Use disposable accounts on a Matrix homeserver that supports the required sync and device-verification flows. Test on supported macOS (13+), Windows x64 with WebView2, and Linux x64 with GTK4/WebKit. Do not use personal accounts or save test credentials in workflow logs.

1. Install the exact artifact and verify its version and provenance. On macOS, check Gatekeeper and the stapled DMG if notarization is enabled; on Windows, check Authenticode if signing is enabled.
2. Verify a new session, send and receive an encrypted message and a media attachment, then go offline and reconnect. Confirm the session starts syncing without discarding cached history.
3. Send a scheduled message and confirm it is delivered once. Receive a native notification and verify clicking it opens the right room. Quit and reopen to check drafts and sync recovery.
4. Upgrade a disposable profile from the previous stable release and verify history, settings, and basic accessibility. Check settings search with keyboard and a screen reader at the minimum window size, 125% zoom, and a non-English locale.
5. Log out and relaunch. Confirm that Pinger requires sign-in again and that no old chat history is displayed. Verify that downloads and standalone AI chats still exist and that Storage can clear the media cache independently.

### Signing And Rollback

- macOS: set `PINGER_SIGN_MACOS=true` and `MACOS_SIGNING_IDENTITY` to the Developer ID Application identity. Set Actions secrets `MACOS_SIGNING_CERTIFICATE` (base64 PKCS#12), `MACOS_SIGNING_PASSWORD`, `MACOS_NOTARY_API_KEY` (base64 App Store Connect `.p8` key), `MACOS_NOTARY_KEY_ID`, and `MACOS_NOTARY_ISSUER`. The workflow signs the app, notarizes the DMG, and validates the stapled ticket. Without the flag, builds stay ad-hoc signed.
- Windows: set `PINGER_SIGN_WINDOWS=true` with Actions secrets `WINDOWS_SIGNING_CERTIFICATE` (base64 PFX with a usable Authenticode signing identity) and `WINDOWS_SIGNING_PASSWORD`. The workflow verifies the timestamped signature before packaging. Hardware-backed or cloud signing requires wiring the chosen provider instead of the PFX step. Without the flag, the executable is unsigned.
- For a broken release, stop propagation to Homebrew, APT, and WinGet where possible and link users to the last known-good asset. Do not overwrite assets under the same tag. Prefer a higher fixed version to downgrading an existing profile. Before a downgrade, stop Pinger and preserve the profile; an older binary might not open a database migrated by a newer build. Verify the rollback on disposable data before recommending it.