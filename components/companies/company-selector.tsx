"use client";

import Link from "next/link";
import { useRef } from "react";
import { ArrowRight, Building2, ExternalLink, MapPin, Plus, X } from "lucide-react";
import { createCompanyAction } from "@/app/actions";
import type { CompanyWorkspace } from "@/lib/types";

type CompanySelectorProps = {
  companies: CompanyWorkspace[];
  schemaReady: boolean;
  userEmail: string;
};

function companyMeta(company: CompanyWorkspace) {
  return [company.industry, company.city, company.tax_id ? `NIP ${company.tax_id}` : null].filter(Boolean).join(" · ");
}

export function CompanySelector({ companies, schemaReady, userEmail }: CompanySelectorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <main className="co-selector-page">
      <header className="co-selector-topbar">
        <div className="co-wordmark" aria-label="Project Octopus">
          <strong>OCTOPUS</strong>
          <div className="co-wordmark-meta">
            <span>Project Octopus</span>
            <a className="co-pureinvest-button" href="https://pure-invest.pl" aria-label="Przejdź do PureInvest Wiktor Purczyński">
              PureInvest Wiktor Purczyński
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          </div>
        </div>
        <div className="co-selector-account">
          <span>{userEmail}</span>
          <form action="/auth/sign-out" method="post">
            <button type="submit" className="co-logout-button">Wyloguj</button>
          </form>
        </div>
      </header>

      <section className="co-selector-heading">
        <p className="co-kicker">Panel administratora</p>
        <h1>Wybierz firmę</h1>
        <p>Każda firma ma własne inwestycje, dokumenty, dane operacyjne i osobny kontekst OctopusAI.</p>
      </section>

      <section className="co-company-grid" aria-label="Firmy">
        {companies.map((company, index) => (
          <Link
            href={`/workspace/companies/${company.id}`}
            className={`co-company-card co-company-card--${(index % 4) + 1}`}
            key={company.id}
          >
            <div className="co-company-card__orb" aria-hidden="true" />
            <div className="co-company-card__topline">
              <span>Firma</span>
              <span>{company.project_count ?? 0} inwestycji</span>
            </div>
            <div>
              <h2>{company.name}</h2>
              <p>{companyMeta(company) || "Profil firmy gotowy do uzupełnienia"}</p>
            </div>
            <div className="co-company-card__footer">
              <span>
                <Building2 size={15} aria-hidden="true" />
                {company.contact_person || "Panel przedsiębiorstwa"}
              </span>
              <strong>
                Otwórz panel <ArrowRight size={16} aria-hidden="true" />
              </strong>
            </div>
          </Link>
        ))}

        <button
          type="button"
          className="co-company-card co-company-card--add"
          onClick={() => dialogRef.current?.showModal()}
          disabled={!schemaReady}
        >
          <span className="co-company-add-icon"><Plus size={30} aria-hidden="true" /></span>
          <span>
            <strong>Dodaj nową firmę</strong>
            <small>{schemaReady ? "Utwórz osobny obszar przedsiębiorstwa" : "Wymagana najnowsza migracja Supabase"}</small>
          </span>
        </button>
      </section>

      <dialog ref={dialogRef} className="co-company-dialog" onClick={(event) => {
        if (event.target === event.currentTarget) {
          dialogRef.current?.close();
        }
      }}>
        <form action={createCompanyAction} className="co-company-form">
          <div className="co-company-form__head">
            <div>
              <p className="co-kicker">Nowa organizacja</p>
              <h2>Dodaj firmę</h2>
            </div>
            <button type="button" className="co-icon-button" onClick={() => dialogRef.current?.close()} aria-label="Zamknij">
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          <div className="co-form-grid">
            <label className="co-field co-field--wide">
              <span>Nazwa firmy *</span>
              <input name="name" required minLength={2} placeholder="np. PureInvest Sp. z o.o." />
            </label>
            <label className="co-field">
              <span>NIP</span>
              <input name="tax_id" inputMode="numeric" placeholder="1234567890" />
            </label>
            <label className="co-field">
              <span>REGON</span>
              <input name="regon" inputMode="numeric" />
            </label>
            <label className="co-field co-field--wide">
              <span>Branża / profil działalności</span>
              <input name="industry" placeholder="np. instalacje sanitarne i HVAC" />
            </label>
            <label className="co-field co-field--wide">
              <span>Ulica i numer</span>
              <input name="street" />
            </label>
            <label className="co-field">
              <span>Kod pocztowy</span>
              <input name="postal_code" placeholder="00-000" />
            </label>
            <label className="co-field">
              <span>Miasto</span>
              <div className="co-input-icon"><MapPin size={16} aria-hidden="true" /><input name="city" /></div>
            </label>
            <label className="co-field">
              <span>E-mail</span>
              <input name="email" type="email" />
            </label>
            <label className="co-field">
              <span>Telefon</span>
              <input name="phone" type="tel" />
            </label>
            <label className="co-field co-field--wide">
              <span>Osoba kontaktowa</span>
              <input name="contact_person" />
            </label>
            <label className="co-field co-field--wide">
              <span>Notatka</span>
              <textarea name="notes" rows={3} placeholder="Dodatkowe informacje o firmie" />
            </label>
          </div>

          <div className="co-company-form__actions">
            <button type="button" className="co-secondary-button" onClick={() => dialogRef.current?.close()}>Anuluj</button>
            <button type="submit" className="co-primary-button"><Plus size={17} aria-hidden="true" /> Dodaj firmę</button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
