import { useHashRoute, type Route } from "./hooks/useHashRoute";
import { WalletButton } from "./components/WalletButton";
import { NetworkBanner } from "./components/NetworkBanner";
import { AgencyDesk } from "./pages/AgencyDesk";
import { ReliefIds } from "./pages/ReliefIds";
import { CoordinatorPanel } from "./pages/CoordinatorPanel";
import { Dashboard } from "./pages/Dashboard";
import { About } from "./pages/About";

const NAV: { route: Route; label: string }[] = [
  { route: "desk", label: "Agency Desk" },
  { route: "relief-ids", label: "Relief IDs" },
  { route: "coordinator", label: "Coordinator" },
  { route: "dashboard", label: "Dashboard" },
  { route: "about", label: "About" },
];

export default function App() {
  const route = useHashRoute();

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a href="#/desk" className="brand">
            <img src="/favicon.svg" alt="" width={28} height={28} />
            <span>
              Relief<span className="brand-accent">Chain</span>
            </span>
          </a>
          <nav className="nav" aria-label="Main">
            {NAV.map((item) => (
              <a key={item.route} href={`#/${item.route}`} aria-current={route === item.route ? "page" : undefined}>
                {item.label}
              </a>
            ))}
          </nav>
          <WalletButton />
        </div>
      </header>

      <main className="container">
        <NetworkBanner />
        {route === "desk" && <AgencyDesk />}
        {route === "relief-ids" && <ReliefIds />}
        {route === "coordinator" && <CoordinatorPanel />}
        {route === "dashboard" && <Dashboard />}
        {route === "about" && <About />}
      </main>

      <footer className="footer">
        ReliefChain · university blockchain project · no personal data is stored on-chain
      </footer>
    </>
  );
}
