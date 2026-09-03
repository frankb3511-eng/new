import HealthProbes from "./HealthProbes";

export default function HealthPage() {
  return (
    <>
      <h1>Live source verification</h1>
      <p className="subtitle">
        Every default keyless integration is probed live from this server with a harmless request. This is
        the verification layer: if a source stops working, changes its endpoint, or the network blocks it,
        it shows up here as unreachable — the scan engine reports the same status and never fakes a result.
      </p>
      <HealthProbes />
    </>
  );
}
