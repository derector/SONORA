# SONORA Android release signing

This setup creates one long-lived Android upload/release key on a trusted device and stores the keystore only in GitHub Actions Secrets. Never commit the keystore, passwords, or Base64 keystore contents.

## 1. Create the keystore on a trusted device

Install a Java 17 JDK with `keytool` available (on Android, Termux can use `pkg install openjdk-17`). Run:

```sh
umask 077
mkdir -p "$HOME/sonora-signing"
cd "$HOME/sonora-signing"
keytool -genkeypair -v \
  -keystore sonora-release.jks \
  -alias sonora-release \
  -keyalg RSA -keysize 4096 -validity 10000
```

Let `keytool` prompt interactively for a strong keystore password, key password, and certificate details. Use the same password for the keystore and key if you want the simplest setup. Do not put passwords directly in command-line arguments or shell history.

Keep two encrypted backups of `sonora-release.jks` in separate safe locations. Losing this file and its passwords can make future updates impossible.

## 2. Verify and encode the keystore

```sh
keytool -list -v -keystore sonora-release.jks -alias sonora-release
base64 < sonora-release.jks | tr -d '\n'
```

The first command prompts for the keystore password and displays the certificate SHA-256 fingerprint. Save that fingerprint in your release records. The second command prints the Base64 keystore payload. Copy it directly into the GitHub secret field; do not put it in a repository file or chat.

## 3. Add GitHub Actions repository secrets

Open the repository:

`https://github.com/derector/SONORA/settings/secrets/actions`

Choose **New repository secret** and create these four secrets exactly:

- `SONORA_ANDROID_KEYSTORE_BASE64`: the Base64 output from step 2
- `SONORA_ANDROID_KEYSTORE_PASSWORD`: keystore password
- `SONORA_ANDROID_KEY_ALIAS`: `sonora-release`
- `SONORA_ANDROID_KEY_PASSWORD`: key password

Do not add these as ordinary repository variables. Do not share the values in issues, pull requests, commits, logs, or chat.

## 4. Build and verify

After all four secrets exist, run the **SONORA Android APK** workflow using `workflow_dispatch` or push an approved change. The workflow should produce `SONORA-Android-release`. If secrets are missing, it deliberately produces a QA-only debug APK instead.

Verify the release APK certificate before distributing it:

```sh
apksigner verify --verbose --print-certs app-release.apk
```

Record the signer SHA-256 fingerprint and compare it with the keystore certificate fingerprint. Every future update must use this same keystore and alias.

## 5. Important migration limitation

Android only permits an in-place update when the new APK is signed by the same signing certificate, or by a valid Android signing-key rotation lineage. A new persistent key cannot update an installation signed by an unavailable temporary CI debug key.

Do not uninstall the currently installed SONORA app until its local data and offline downloads have been backed up or their loss has been explicitly accepted. If the existing installation uses a different ephemeral debug certificate and its private key cannot be recovered, a one-time migration/reinstall may ultimately be unavoidable. Server-side account data is separate, but local-only data may not be recoverable.

## Security checklist

- [ ] Keystore generated on a trusted device.
- [ ] Two encrypted backups stored separately.
- [ ] Four GitHub Actions secrets configured.
- [ ] Release APK signer fingerprint matches the saved certificate fingerprint.
- [ ] Existing installed app signer checked before any reinstall.
- [ ] No uninstall or data-clearing action performed without a separate backup and explicit approval.
