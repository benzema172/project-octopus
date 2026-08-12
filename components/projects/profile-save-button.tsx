"use client";

import { Save } from "lucide-react";
import { useFormStatus } from "react-dom";

export function ProfileSaveButton() {
  const { pending } = useFormStatus();

  return (
    <button className="primary-button" type="submit" disabled={pending}>
      <Save size={18} aria-hidden="true" />
      {pending ? "Zapisywanie" : "Zapisz dane"}
    </button>
  );
}
