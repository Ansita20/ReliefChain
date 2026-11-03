/**
 * Input for the campaign secret: type/paste it, or load the secret file the coordinator gave you.
 *
 * Privacy rules:
 *  - The secret is kept ONLY in React state (memory). It is never written to
 *    localStorage, cookies or the URL, and it disappears when the tab is closed.
 *  - We use a text input with masking instead of type="password", so the browser's
 *    password manager doesn't offer to save it.
 */
import { useRef, useState } from "react";
import { isValidCampaignSecret } from "@shared/nullifier";

export interface SecretFile {
  campaignSecret?: string;
  enrollmentSecret?: string; // Relief ID enrollment secret file
  campaignId?: number;
  chainId?: number;
}

export function SecretInput({
  id = "campaign-secret",
  kind = "campaign",
  value,
  onChange,
  onFileLoaded,
}: {
  id?: string;
  kind?: "campaign" | "enrollment";
  value: string;
  onChange: (secret: string) => void;
  onFileLoaded?: (file: SecretFile) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function loadFile(file: File) {
    setFileError(null);
    const text = (await file.text()).trim();
    let parsed: SecretFile | null = null;
    try {
      // Either the JSON file written by the seed script / coordinator panel…
      parsed = JSON.parse(text) as SecretFile;
      const secret = kind === "enrollment" ? parsed.enrollmentSecret : parsed.campaignSecret;
      if (!secret || !isValidCampaignSecret(secret)) throw new Error();
      onChange(secret);
      onFileLoaded?.(parsed);
    } catch {
      // …or a plain text file containing just the secret
      if (isValidCampaignSecret(text)) onChange(text);
      // The campaign and enrollment files sit side by side, so picking the other one is an easy mistake.
      else if (kind === "campaign" && parsed?.enrollmentSecret)
        setFileError(
          `"${file.name}" is the Relief ID enrollment secret (for the Relief IDs page). Here, load the campaign file, e.g. localhost-campaign-1.json.`,
        );
      else if (kind === "enrollment" && parsed?.campaignSecret)
        setFileError(`"${file.name}" is a campaign secret (for the Agency Desk). Here, load localhost-enrollment.json.`);
      else setFileError(`"${file.name}" does not contain a valid ${kind} secret.`);
    }
    if (fileInput.current) fileInput.current.value = ""; // allow re-loading the same file
  }

  const invalid = value !== "" && !isValidCampaignSecret(value);

  return (
    <div className="secret-input">
      <div className="input-row">
        <input
          id={id}
          type="text"
          className={`mono ${visible ? "" : "masked"}`}
          placeholder="0x… (64 hex characters)"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          autoComplete="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          aria-invalid={invalid}
          aria-describedby={`${id}-help`}
        />
        <button type="button" className="btn btn-sm" onClick={() => setVisible((v) => !v)}>
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      <div className="input-row">
        <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()}>
          Load secret file
        </button>
        {value && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange("")}>
            Forget secret
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".json,.txt,application/json,text/plain"
          hidden
          onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
        />
      </div>
      <p id={`${id}-help`} className="hint">
        {invalid ? (
          <span className="text-bad">The secret must be 0x followed by 64 hex characters.</span>
        ) : fileError ? (
          <span className="text-bad">{fileError}</span>
        ) : (
          "Kept in this tab's memory only. Never stored, never sent."
        )}
      </p>
    </div>
  );
}
