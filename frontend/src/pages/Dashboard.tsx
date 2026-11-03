/**
 * Public Transparency Dashboard: no wallet needed.
 *
 * Everything here is rebuilt from the contract's public event log. Only counts and
 * hash prefixes are shown: there is no personal data on-chain to show.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useWallet } from "../hooks/useWallet";
import { useRegistryEvents } from "../hooks/useRegistryEvents";
import { useCampaigns } from "../hooks/useCampaigns";
import { useChartTheme, type ChartTheme } from "../hooks/useColorScheme";
import { CHAINS, addressUrl, getDeployment, txUrl } from "../lib/chains";
import { STANDARD_AID_TYPES, aidLabel, decodeAidType } from "../lib/aidTypes";
import { findVoidedRecordIds, type RegistryEvent } from "../lib/events";
import { shortAddress, shortHash, timeAgo } from "../lib/format";
import { CampaignSelect } from "../components/CampaignSelect";

const OTHER = "Other";
const MAX_SERIES = 8; // the palette has 8 colours; anything beyond is folded into "Other"

export function Dashboard() {
  const { appChainId } = useWallet();
  const { events, loading, error, lastUpdated } = useRegistryEvents(appChainId);
  const { campaigns } = useCampaigns(appChainId);
  const theme = useChartTheme();
  const [campaignFilter, setCampaignFilter] = useState<number | null>(null);
  const [groupBy, setGroupBy] = useState<"aid" | "agency">("aid");
  const [showTable, setShowTable] = useState(false);

  // Agency address -> latest name (from AgencyApproved events)
  const agencyNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const ev of events) {
      if ((ev.kind === "AgencyApproved" || ev.kind === "VerifierApproved") && ev.agency) {
        names.set(ev.agency.toLowerCase(), ev.name ?? "");
      }
    }
    return names;
  }, [events]);
  const agencyName = (addr?: string) => (addr ? agencyNames.get(addr.toLowerCase()) || shortAddress(addr) : "-");

  const stats = useMemo(() => {
    const voided = findVoidedRecordIds(events);
    const inScope = (e: RegistryEvent) => campaignFilter === null || e.campaignId === campaignFilter;
    const records = events.filter((e) => e.kind === "DistributionRecorded" && !voided.has(e.id) && inScope(e));
    const voids = events.filter((e) => e.kind === "DistributionVoided" && inScope(e));

    // Series order is fixed (standard aid types first, agencies in approval order),
    // so an entity keeps its colour when the filter changes.
    const aidOrder = orderedKeys([...STANDARD_AID_TYPES, ...events.map((e) => (e.aidType ? decodeAidType(e.aidType) : ""))]);
    const agencyOrder = orderedKeys(events.filter((e) => e.kind === "AgencyApproved").map((e) => agencyName(e.agency)));

    const aidKeyOf = (e: RegistryEvent) => foldKey(decodeAidType(e.aidType!), aidOrder);
    const agencyKeyOf = (e: RegistryEvent) => foldKey(agencyName(e.agency), agencyOrder);

    return {
      records,
      voidCount: voids.length,
      people: new Set(records.map((r) => `${r.campaignId}|${r.nullifier}`)).size,
      agencies: new Set(records.map((r) => r.agency)).size,
      aidOrder,
      agencyOrder,
      byAid: countBy(records, aidKeyOf, aidOrder),
      byAgency: countBy(records, agencyKeyOf, agencyOrder),
      overTime: {
        aid: timeSeries(records, aidKeyOf, aidOrder),
        agency: timeSeries(records, agencyKeyOf, agencyOrder),
      },
    };
  }, [events, campaignFilter, agencyNames]);

  const series = groupBy === "aid" ? stats.aidOrder : stats.agencyOrder;
  const timeData = groupBy === "aid" ? stats.overTime.aid : stats.overTime.agency;
  const activeSeries = series.filter((key) => timeData.rows.some((row) => Number(row[key]) > 0));
  const feed = [...events]
    .filter((e) => campaignFilter === null || e.campaignId === campaignFilter || e.campaignId === undefined)
    .reverse()
    .slice(0, 25);

  const deployment = getDeployment(appChainId);
  const contractLink = deployment ? addressUrl(appChainId, deployment.address) : null;

  return (
    <div className="page">
      <header className="page-header">
        <span className="eyebrow">Public · no wallet needed</span>
        <h1>Transparency Dashboard</h1>
        <p className="lead">
          Public audit trail, rebuilt live from blockchain events. Anyone can verify these numbers. No names or IDs are
          stored, so none can be shown.
        </p>
      </header>

      {/* Filters: one row, above everything they scope */}
      <div className="filter-row">
        <div className="field field-inline">
          <label htmlFor="d-campaign">Campaign</label>
          <CampaignSelect id="d-campaign" campaigns={campaigns} value={campaignFilter} onChange={setCampaignFilter} allowAll />
        </div>
        <span className="hint live">
          <span className={`live-dot ${error ? "live-dot-bad" : ""}`} aria-hidden="true" />
          {error ? error : lastUpdated ? `Live · updated ${lastUpdated.toLocaleTimeString()}` : "Loading…"}
        </span>
      </div>

      <div className={`dash ${loading ? "is-loading" : ""}`}>
        <div className="stat-row">
          <Stat label="Distributions" value={stats.records.length} note="active, after voids" />
          <Stat label="Beneficiaries served" value={stats.people} note="unique hashes" />
          <Stat label="Agencies active" value={stats.agencies} />
          <Stat label="Entries voided" value={stats.voidCount} />
        </div>

        <ChartCard
          title="Distributions over time"
          wide
          actions={
            <div className="segmented" role="group" aria-label="Group by">
              <button className={groupBy === "aid" ? "on" : ""} aria-pressed={groupBy === "aid"} onClick={() => setGroupBy("aid")}>
                By aid type
              </button>
              <button
                className={groupBy === "agency" ? "on" : ""}
                aria-pressed={groupBy === "agency"}
                onClick={() => setGroupBy("agency")}
              >
                By agency
              </button>
            </div>
          }
        >
          {timeData.rows.length === 0 ? (
            <Empty />
          ) : showTable ? (
            <DataTable
              headers={["Time", ...activeSeries]}
              rows={timeData.rows.map((r) => [String(r.label), ...activeSeries.map((k) => String(r[k] ?? 0))])}
            />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={timeData.rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid vertical={false} stroke={theme.grid} />
                <XAxis dataKey="label" tick={{ fill: theme.muted, fontSize: 12 }} axisLine={{ stroke: theme.axis }} tickLine={false} minTickGap={16} />
                <YAxis allowDecimals={false} tick={{ fill: theme.muted, fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip
                  content={({ active, payload, label }) => (
                    <ChartTooltip active={active} payload={payload} label={label} colorOf={(p) => p.color ?? theme.muted} />
                  )}
                  cursor={{ fill: theme.grid, opacity: 0.5 }}
                />
                <Legend
                  iconType="square"
                  itemSorter={null}
                  wrapperStyle={{ fontSize: 13 }}
                  formatter={(value) => <span style={{ color: theme.text }}>{value}</span>}
                />
                {activeSeries.map((key, i) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    name={groupBy === "aid" ? aidLabel(key) : key}
                    stackId="t"
                    fill={colorFor(key, series, theme)}
                    stroke={theme.surface}
                    strokeWidth={2}
                    radius={i === activeSeries.length - 1 ? [4, 4, 0, 0] : 0}
                    maxBarSize={40}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="chart-foot">
            <span className="hint">Grouped per {timeData.bucketName}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowTable((s) => !s)}>
              {showTable ? "Show chart" : "Show table"}
            </button>
          </div>
        </ChartCard>

        <ChartCard title="By aid type">
          <HorizontalBars data={stats.byAid.map((d) => ({ ...d, label: aidLabel(d.key) }))} order={stats.aidOrder} theme={theme} />
        </ChartCard>

        <ChartCard title="By agency">
          <HorizontalBars data={stats.byAgency.map((d) => ({ ...d, label: d.key }))} order={stats.agencyOrder} theme={theme} />
        </ChartCard>

        <section className="card card-wide">
          <h2>Live activity</h2>
          {feed.length === 0 ? (
            <Empty />
          ) : (
            <ul className="feed">
              {feed.map((ev) => (
                <FeedItem key={ev.id} ev={ev} agencyName={agencyName} chainId={appChainId} />
              ))}
            </ul>
          )}
        </section>

        {deployment && (
          <p className="hint contract-foot">
            Contract on {CHAINS[appChainId]?.name}:{" "}
            {contractLink ? (
              <a href={contractLink} target="_blank" rel="noreferrer">
                <code>{deployment.address}</code> ↗
              </a>
            ) : (
              <code>{deployment.address}</code>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

/** Unique, non-empty keys in first-seen order; more than MAX_SERIES are folded into "Other". */
function orderedKeys(keys: string[]): string[] {
  const unique = [...new Set(keys.filter(Boolean))];
  return unique.length <= MAX_SERIES ? unique : [...unique.slice(0, MAX_SERIES - 1), OTHER];
}

function foldKey(key: string, order: string[]): string {
  return order.includes(key) ? key : OTHER;
}

function colorFor(key: string, order: string[], theme: ChartTheme): string {
  const i = order.indexOf(key);
  return key === OTHER || i < 0 ? theme.muted : theme.series[i];
}

function countBy(records: RegistryEvent[], keyOf: (e: RegistryEvent) => string, order: string[]) {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(keyOf(r), (counts.get(keyOf(r)) ?? 0) + 1);
  return order.filter((k) => counts.has(k)).map((key) => ({ key, count: counts.get(key)! }));
}

/** Group records into time buckets. Bucket size adapts to how long the data spans. */
function timeSeries(records: RegistryEvent[], keyOf: (e: RegistryEvent) => string, order: string[]) {
  if (records.length === 0) return { rows: [] as Record<string, string | number>[], bucketName: "hour" };

  const times = records.map((r) => r.timestamp);
  const min = Math.min(...times);
  const span = Math.max(...times) - min;
  const [size, bucketName] =
    span <= 3 * 3600 ? [600, "10 minutes"] : span <= 2 * 86400 ? [3600, "hour"] : span <= 60 * 86400 ? [86400, "day"] : [7 * 86400, "week"];

  const first = Math.floor(min / size) * size;
  const count = Math.floor((Math.max(...times) - first) / size) + 1;
  const rows: Record<string, string | number>[] = Array.from({ length: count }, (_, i) => {
    const t = new Date((first + i * size) * 1000);
    const label =
      size < 86400
        ? t.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
        : t.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    const row: Record<string, string | number> = { label };
    for (const key of order) row[key] = 0;
    return row;
  });

  for (const r of records) {
    const row = rows[Math.floor((r.timestamp - first) / size)];
    row[keyOf(r)] = Number(row[keyOf(r)] ?? 0) + 1;
  }
  return { rows, bucketName };
}

// ---------------------------------------------------------------------------
// Small UI pieces
// ---------------------------------------------------------------------------

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value.toLocaleString()}</div>
      <div className="stat-label">{label}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

function ChartCard({ title, actions, wide, children }: { title: string; actions?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`card ${wide ? "card-wide" : ""}`}>
      <div className="card-head">
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="hint empty">No distributions recorded yet.</p>;
}

/** Horizontal bars with the value written at the end of each bar. */
function HorizontalBars({
  data,
  order,
  theme,
}: {
  data: { key: string; label: string; count: number }[];
  order: string[];
  theme: ChartTheme;
}) {
  if (data.length === 0) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 44 + 20)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 0 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="label" width={130} tick={{ fill: theme.text, fontSize: 13 }} axisLine={false} tickLine={false} />
        <Tooltip
          content={({ active, payload, label }) => (
            <ChartTooltip
              active={active}
              payload={payload}
              label={label}
              colorOf={(p) => colorFor(String(p.payload?.key), order, theme)}
            />
          )}
          cursor={{ fill: theme.grid, opacity: 0.5 }}
        />
        <Bar dataKey="count" name="Distributions" radius={[0, 4, 4, 0]} barSize={20} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.key} fill={colorFor(d.key, order, theme)} />
          ))}
          <LabelList dataKey="count" position="right" fill={theme.text} fontSize={13} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** One row of tooltip data, as Recharts passes it. */
interface TooltipEntry {
  dataKey?: unknown;
  name?: unknown;
  value?: unknown;
  color?: string;
  payload?: Record<string, unknown>;
}

/** Tooltip: values first (bold), series names second, short colour line as the key. */
function ChartTooltip({
  active,
  payload,
  label,
  colorOf,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: unknown;
  colorOf: (entry: TooltipEntry) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const nonZero = payload.filter((p) => Number(p.value) > 0);
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{String(label ?? payload[0]?.payload?.label ?? "")}</div>
      {(nonZero.length ? nonZero : payload).map((p) => (
        <div key={String(p.dataKey)} className="chart-tooltip-row">
          <span className="chart-tooltip-key" style={{ background: colorOf(p) }} />
          <strong>{String(p.value)}</strong>
          <span>{String(p.name)}</span>
        </div>
      ))}
    </div>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{aidLabel(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FEED_LABEL: Record<RegistryEvent["kind"], string> = {
  DistributionRecorded: "Recorded",
  DistributionVoided: "Voided",
  CampaignCreated: "Campaign created",
  CampaignClosed: "Campaign closed",
  AgencyApproved: "Agency approved",
  AgencyRemoved: "Agency removed",
  VerifierApproved: "Verifier approved",
  VerifierRemoved: "Verifier removed",
  ReliefIdEnrolled: "Relief ID enrolled",
  ReliefIdVouched: "Relief ID vouched",
  ReliefIdRevoked: "Relief ID revoked",
  ReliefIdReplaced: "Relief ID replaced",
};

function FeedItem({ ev, agencyName, chainId }: { ev: RegistryEvent; agencyName: (a?: string) => string; chainId: number }) {
  const link = txUrl(chainId, ev.txHash);
  let detail: ReactNode;
  switch (ev.kind) {
    case "DistributionRecorded":
      detail = (
        <>
          <span className="badge">{aidLabel(decodeAidType(ev.aidType!))}</span> <code>{shortHash(ev.nullifier!)}</code> by{" "}
          {agencyName(ev.agency)}
        </>
      );
      break;
    case "DistributionVoided":
      detail = (
        <>
          <span className="badge">{aidLabel(decodeAidType(ev.aidType!))}</span> <code>{shortHash(ev.nullifier!)}</code>, reason: "
          {ev.reason}"
        </>
      );
      break;
    case "CampaignCreated":
      detail = (
        <>
          #{ev.campaignId} {ev.name} ({ev.region})
        </>
      );
      break;
    case "CampaignClosed":
      detail = <>#{ev.campaignId}</>;
      break;
    case "AgencyApproved":
      detail = <>{ev.name}</>;
      break;
    case "AgencyRemoved":
    case "VerifierRemoved":
      detail = <>{agencyName(ev.agency)}</>;
      break;
    case "VerifierApproved":
      detail = <>{ev.name}</>;
      break;
    case "ReliefIdEnrolled":
      detail = (
        <>
          card <code>{shortHash(ev.cardHash!)}</code> by {agencyName(ev.actor)}
        </>
      );
      break;
    case "ReliefIdVouched":
      detail = (
        <>
          card <code>{shortHash(ev.cardHash!)}</code> by {agencyName(ev.actor)} ({ev.vouchCount} vouches)
        </>
      );
      break;
    case "ReliefIdRevoked":
      detail = (
        <>
          card <code>{shortHash(ev.cardHash!)}</code>, reason: "{ev.reason}"
        </>
      );
      break;
    case "ReliefIdReplaced":
      detail = (
        <>
          card <code>{shortHash(ev.cardHash!)}</code> → <code>{shortHash(ev.newCardHash!)}</code>, reason: "{ev.reason}"
        </>
      );
      break;
  }

  return (
    <li className={`feed-item feed-${ev.kind}`}>
      <span className="feed-kind">{FEED_LABEL[ev.kind]}</span>
      <span className="feed-detail">{detail}</span>
      <span className="feed-time">
        {link ? (
          <a href={link} target="_blank" rel="noreferrer">
            {timeAgo(ev.timestamp)} ↗
          </a>
        ) : (
          timeAgo(ev.timestamp)
        )}
      </span>
    </li>
  );
}
