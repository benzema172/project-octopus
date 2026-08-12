import { updateProjectProfileAction } from "@/app/actions";
import { ProfileSaveButton } from "@/components/projects/profile-save-button";
import type { ProjectProfile } from "@/lib/types";

type ProjectProfileFormProps = {
  projectId: string;
  profile: ProjectProfile;
  saved: boolean;
};

type FieldProps = {
  label: string;
  name: keyof ProjectProfile;
  profile: ProjectProfile;
  type?: "text" | "email" | "tel" | "date" | "number";
  placeholder?: string;
  wide?: boolean;
};

function Field({ label, name, profile, type = "text", placeholder, wide = false }: FieldProps) {
  return (
    <label className={wide ? "profile-field profile-field--wide" : "profile-field"}>
      <span>{label}</span>
      <input name={name} type={type} defaultValue={profile[name]} placeholder={placeholder} />
    </label>
  );
}

type TextAreaProps = {
  label: string;
  name: keyof ProjectProfile;
  profile: ProjectProfile;
  placeholder?: string;
};

function TextArea({ label, name, profile, placeholder }: TextAreaProps) {
  return (
    <label className="profile-field profile-field--wide">
      <span>{label}</span>
      <textarea name={name} defaultValue={profile[name]} placeholder={placeholder} rows={4} />
    </label>
  );
}

export function ProjectProfileForm({ projectId, profile, saved }: ProjectProfileFormProps) {
  const action = updateProjectProfileAction.bind(null, projectId);

  return (
    <form className="project-profile-form" action={action}>
      <div className="project-profile-actions">
        <div>
          <p className="eyebrow">Stałe dane</p>
          <h2>Karta inwestycji</h2>
          {saved ? <p className="save-confirmation">Dane zostały zapisane.</p> : null}
        </div>
        <ProfileSaveButton />
      </div>

      <fieldset className="project-data-section">
        <legend>Identyfikacja inwestycji</legend>
        <div className="project-data-grid">
          <Field label="Pełna nazwa inwestycji" name="projectName" profile={profile} wide />
          <Field label="Nazwa skrócona" name="shortName" profile={profile} />
          <Field label="Rodzaj inwestycji" name="projectType" profile={profile} placeholder="np. budowa, przebudowa, remont" />
          <label className="profile-field">
            <span>Status</span>
            <select name="status" defaultValue={profile.status}>
              <option value="planned">Planowana</option>
              <option value="tender">Przetarg</option>
              <option value="active">Aktywna</option>
              <option value="paused">Wstrzymana</option>
              <option value="completed">Zakończona</option>
              <option value="archived">Archiwalna</option>
            </select>
          </label>
          <TextArea label="Opis i zakres inwestycji" name="description" profile={profile} />
        </div>
      </fieldset>

      <fieldset className="project-data-section">
        <legend>Lokalizacja i decyzje</legend>
        <div className="project-data-grid">
          <Field label="Ulica i numer" name="street" profile={profile} />
          <Field label="Kod pocztowy" name="postalCode" profile={profile} />
          <Field label="Miejscowość" name="city" profile={profile} />
          <Field label="Gmina" name="municipality" profile={profile} />
          <Field label="Powiat" name="county" profile={profile} />
          <Field label="Województwo" name="voivodeship" profile={profile} />
          <Field label="Numery działek" name="plotNumbers" profile={profile} wide />
          <Field label="Pozwolenie / zgłoszenie" name="buildingPermit" profile={profile} wide />
        </div>
      </fieldset>

      <fieldset className="project-data-section">
        <legend>Umowa i terminy</legend>
        <div className="project-data-grid">
          <Field label="Numer umowy" name="contractNumber" profile={profile} />
          <Field label="Data umowy" name="contractDate" profile={profile} type="date" />
          <Field label="Data rozpoczęcia" name="startDate" profile={profile} type="date" />
          <Field label="Termin zakończenia" name="completionDate" profile={profile} type="date" />
          <Field label="Koniec gwarancji" name="warrantyEndDate" profile={profile} type="date" />
          <Field label="Wartość umowy netto/brutto" name="contractValue" profile={profile} />
          <Field label="Waluta" name="currency" profile={profile} />
          <Field label="Źródło finansowania" name="fundingSource" profile={profile} />
          <TextArea label="Zakres kontraktowy" name="contractScope" profile={profile} />
        </div>
      </fieldset>

      <fieldset className="project-data-section">
        <legend>Inwestor</legend>
        <div className="project-data-grid">
          <Field label="Nazwa inwestora" name="investorName" profile={profile} wide />
          <Field label="Adres inwestora" name="investorAddress" profile={profile} wide />
          <Field label="NIP" name="investorTaxId" profile={profile} />
          <Field label="Przedstawiciel inwestora" name="investorRepresentative" profile={profile} />
          <Field label="E-mail" name="investorEmail" profile={profile} type="email" />
          <Field label="Telefon" name="investorPhone" profile={profile} type="tel" />
        </div>
      </fieldset>

      <fieldset className="project-data-section">
        <legend>Wykonawcy i projektanci</legend>
        <div className="project-data-grid">
          <Field label="Generalny wykonawca" name="generalContractorName" profile={profile} wide />
          <Field label="Adres wykonawcy" name="generalContractorAddress" profile={profile} wide />
          <Field label="NIP wykonawcy" name="generalContractorTaxId" profile={profile} />
          <Field label="Przedstawiciel wykonawcy" name="generalContractorRepresentative" profile={profile} />
          <Field label="Jednostka projektowa" name="designerName" profile={profile} wide />
          <Field label="Adres projektanta" name="designerAddress" profile={profile} wide />
          <Field label="Inżynier kontraktu / zarządzający" name="contractEngineerName" profile={profile} wide />
        </div>
      </fieldset>

      <fieldset className="project-data-section">
        <legend>Nadzór i osoby funkcyjne</legend>
        <div className="project-data-grid">
          <Field label="Inspektor nadzoru" name="supervisionInspectorName" profile={profile} />
          <Field label="Branża inspektora" name="supervisionInspectorBranch" profile={profile} />
          <Field label="E-mail inspektora" name="supervisionInspectorEmail" profile={profile} type="email" />
          <Field label="Telefon inspektora" name="supervisionInspectorPhone" profile={profile} type="tel" />
          <Field label="Kierownik budowy" name="siteManagerName" profile={profile} />
          <Field label="E-mail kierownika budowy" name="siteManagerEmail" profile={profile} type="email" />
          <Field label="Telefon kierownika budowy" name="siteManagerPhone" profile={profile} type="tel" />
          <Field label="Kierownik robót sanitarnych" name="sanitaryWorksManagerName" profile={profile} />
          <Field label="E-mail kierownika sanitarnego" name="sanitaryWorksManagerEmail" profile={profile} type="email" />
          <Field label="Telefon kierownika sanitarnego" name="sanitaryWorksManagerPhone" profile={profile} type="tel" />
          <Field label="Kierownik robót elektrycznych" name="electricalWorksManagerName" profile={profile} />
          <Field label="E-mail kierownika elektrycznego" name="electricalWorksManagerEmail" profile={profile} type="email" />
          <Field label="Telefon kierownika elektrycznego" name="electricalWorksManagerPhone" profile={profile} type="tel" />
          <TextArea label="Uwagi stałe do dokumentów" name="notes" profile={profile} />
        </div>
      </fieldset>

      <div className="project-profile-footer">
        <ProfileSaveButton />
      </div>
    </form>
  );
}
