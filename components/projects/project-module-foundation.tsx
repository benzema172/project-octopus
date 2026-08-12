import type { LucideIcon } from "lucide-react";

type FoundationItem = {
  title: string;
  description: string;
  icon: LucideIcon;
};

type ProjectModuleFoundationProps = {
  kicker: string;
  title: string;
  description: string;
  status?: string;
  items: FoundationItem[];
  principle: string;
};

export function ProjectModuleFoundation({
  kicker,
  title,
  description,
  status = "Fundament modułu",
  items,
  principle
}: ProjectModuleFoundationProps) {
  return (
    <div className="project-tab-content pw-module-page">
      <section className="pw-module-intro">
        <div>
          <p className="co-kicker">{kicker}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span>{status}</span>
      </section>

      <section className="pw-module-feature-grid">
        {items.map(({ title: itemTitle, description: itemDescription, icon: Icon }) => (
          <article key={itemTitle} className="pw-module-feature-card">
            <span className="pw-card-icon"><Icon size={20} aria-hidden="true" /></span>
            <h3>{itemTitle}</h3>
            <p>{itemDescription}</p>
          </article>
        ))}
      </section>

      <section className="pw-module-principle">
        <strong>Jak ten moduł łączy się z Octopusem</strong>
        <p>{principle}</p>
      </section>
    </div>
  );
}
