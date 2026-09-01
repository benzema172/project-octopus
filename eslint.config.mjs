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
  }
];

export default eslintConfig;
