"use client";

import { useFormStatus } from "react-dom";
import { Building2, MapPin, Plus } from "lucide-react";
import { createProjectAction } from "@/app/actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="primary-button" type="submit" disabled={pending}>
      <Plus size={18} aria-hidden="true" />
      {pending ? "Tworzenie" : "Nowa inwestycja"}
    </button>
  );
}

export function CreateProjectForm() {
  return (
    <form className="create-project" action={createProjectAction}>
      <label className="field field--light">
        <Building2 size={18} aria-hidden="true" />
        <input name="name" placeholder="Nazwa inwestycji" required minLength={2} />
      </label>
      <label className="field field--light">
        <input name="investor_name" placeholder="Inwestor" />
      </label>
      <label className="field field--light">
        <MapPin size={18} aria-hidden="true" />
        <input name="location" placeholder="Lokalizacja" />
      </label>
      <label className="field field--light create-project__description">
        <textarea name="description" placeholder="Krótki opis zakresu" rows={2} />
      </label>
      <SubmitButton />
    </form>
  );
}
