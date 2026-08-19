type RouteLoadingProps = {
  label?: string;
};

export function RouteLoading({ label = "Otwieram widok" }: RouteLoadingProps) {
  return (
    <main className="route-loading" aria-live="polite" aria-busy="true" aria-label={label}>
      <span className="route-loading__eyebrow" aria-hidden="true" />
      <span className="route-loading__title" aria-hidden="true" />
      <span className="route-loading__copy" aria-hidden="true" />
      <div className="route-loading__metrics" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="route-loading__panel" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="ux-sr-only">{label}</p>
    </main>
  );
}
