import SourcesMatrix from "./SourcesMatrix";

export default function SourcesPage() {
  return (
    <>
      <h1>Integration registry & source matrix</h1>
      <p className="subtitle">
        Every capability the workbench uses, with its official documentation, keyless/key/paid status,
        rate limits, automation policy and maintenance/verification status. This registry drives the scan
        engine — new sources are added here without changing scan logic.
      </p>
      <SourcesMatrix />
    </>
  );
}
