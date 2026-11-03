import { campaignStatus, type CampaignInfo } from "../hooks/useCampaigns";

/** Dropdown of campaigns, showing each one's status. */
export function CampaignSelect({
  id,
  campaigns,
  value,
  onChange,
  allowAll = false,
}: {
  id: string;
  campaigns: CampaignInfo[];
  value: number | null;
  onChange: (id: number | null) => void;
  allowAll?: boolean;
}) {
  return (
    <select
      id={id}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    >
      {allowAll ? <option value="">All campaigns</option> : <option value="">Select a campaign…</option>}
      {campaigns.map((c) => (
        <option key={c.id} value={c.id}>
          #{c.id} {c.name} ({campaignStatus(c)})
        </option>
      ))}
    </select>
  );
}
