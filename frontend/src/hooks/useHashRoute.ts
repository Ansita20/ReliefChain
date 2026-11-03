/**
 * A tiny router: the page is chosen by the part of the URL after "#",
 * e.g. http://localhost:5173/#/dashboard. Hash URLs work on any static host.
 */
import { useEffect, useState } from "react";

export type Route = "desk" | "relief-ids" | "coordinator" | "dashboard" | "about";
const ROUTES: Route[] = ["desk", "relief-ids", "coordinator", "dashboard", "about"];

function readRoute(): Route {
  const name = window.location.hash.replace(/^#\/?/, "");
  return (ROUTES as string[]).includes(name) ? (name as Route) : "desk";
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(readRoute);
  useEffect(() => {
    const onChange = () => {
      setRoute(readRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
