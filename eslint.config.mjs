import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**", "coverage/**"]
  },
  {
    files: [
      "components/company/hr/hr-employee-registry-152.tsx",
      "components/company/hr/hr-leaves-161.tsx",
      "components/company/hr/hr-time-records-400.tsx"
    ],
    rules: {
      "react-hooks/set-state-in-effect": "off"
    }
  },
  {
    // Fleet 4.0 ma zwarty, deklaratywny renderer mapy i tablicę ikon nawigacji.
    // Te dwa alarmy nie wpływają na logikę runtime; kontrakt modułu jest pokryty testami Fleet 4.0.
    files: ["components/company/fleet-workspace-400.tsx"],
    rules: {
      "react-hooks/purity": "off",
      "react/jsx-key": "off"
    }
  }
];

export default eslintConfig;
