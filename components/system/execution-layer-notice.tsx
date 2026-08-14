import { DatabaseZap } from "lucide-react";

export function ExecutionLayerNotice() {
  return (
    <section className="execution-layer-notice" role="status">
      <DatabaseZap size={22} aria-hidden="true" />
      <div>
        <strong>Warstwa danych tego modułu nie jest jeszcze aktywna</strong>
        <p>Zastosuj migracje Supabase z katalogu <code>supabase/migrations</code>. Do tego czasu aplikacja nie pokazuje fałszywych zer ani nie pozwala zapisywać niepełnych procesów.</p>
      </div>
    </section>
  );
}
