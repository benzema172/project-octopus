import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateCompensation } from "../lib/hr/compensation";
import { calculateLaborControl } from "../lib/hr/labor-cost-control";
import { countPolishWorkingDays, countPolishWorkingDaysInYear, isPolishWorkingDay } from "../lib/hr/polish-work-calendar";
import { assertTimesheetHours, isIsoDate, isYearMonth } from "../lib/hr/validation";

function rng(seed: number) { let state = seed >>> 0; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; }; }
function isoFromOffset(offset: number) { const date = new Date(Date.UTC(2026, 0, 1)); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); }
function addDays(date: string, days: number) { const parsed = new Date(`${date}T00:00:00Z`); parsed.setUTCDate(parsed.getUTCDate() + days); return parsed.toISOString().slice(0, 10); }
const TABS = ["dashboard", "employees", "time", "leaves", "compliance", "teams", "documents"] as const;
type Tab = typeof TABS[number];
type UiState = { tab: Tab; selectedEmployeeId: string | null; accountingOpen: boolean };
function applyUiAction(state: UiState, action: { kind: "tab"; tab: Tab } | { kind: "employee"; id: string } | { kind: "accounting" }) { if (action.kind === "tab") return { ...state, tab: action.tab, selectedEmployeeId: action.tab === "leaves" ? state.selectedEmployeeId : null }; if (action.kind === "employee") return { ...state, selectedEmployeeId: state.selectedEmployeeId === action.id ? null : action.id }; return { ...state, accountingOpen: !state.accountingOpen }; }

describe("HR stress 10000 — czas pracy i wynagrodzenia", () => {
  for (let index = 0; index < 2500; index += 1) it(`scenario ${index + 1}`, () => {
    const random = rng(1000 + index); const hours = Math.round((0.25 + random() * 15.5) * 4) / 4; const maxOvertime = Math.max(0, 24 - hours); const overtime = Math.round(random() * maxOvertime * 4) / 4;
    expect(() => assertTimesheetHours(hours, overtime)).not.toThrow(); expect(hours + overtime).toBeLessThanOrEqual(24.000001);
    const gross = Math.round((3500 + random() * 16000) * 100) / 100; const net = Math.round(Math.min(gross, gross * (0.55 + random() * 0.25)) * 100) / 100; const contributions = Math.round(random() * 5000 * 100) / 100; const other = Math.round(random() * 1500 * 100) / 100; const nominal = [152,160,168,176,184][Math.floor(random()*5)]!;
    const result = calculateCompensation({ netMonthlyPay: net, grossMonthlyPay: gross, employerContributions: contributions, otherMonthlyCosts: other, nominalMonthlyHours: nominal });
    expect(result.totalEmployerCost).toBeGreaterThanOrEqual(gross); expect(result.effectiveHourlyCost).toBeGreaterThanOrEqual(0); expect(result.netMonthlyPay).toBeLessThanOrEqual(result.grossMonthlyPay ?? gross);
  });
});

describe("HR stress 10000 — kalendarz i urlopy", () => {
  for (let index = 0; index < 2500; index += 1) it(`scenario ${index + 2501}`, () => {
    const random = rng(20000 + index); const from = isoFromOffset(Math.floor(random() * 365)); const span = Math.floor(random() * 45); const to = addDays(from, span);
    expect(isIsoDate(from)).toBe(true); expect(isIsoDate(to)).toBe(true); const count = countPolishWorkingDays(from, to); expect(count).toBeGreaterThanOrEqual(0); expect(count).toBeLessThanOrEqual(span + 1); const year = Number(from.slice(0,4)); const inYear = countPolishWorkingDaysInYear(from,to,year); expect(inYear).toBeGreaterThanOrEqual(0); expect(inYear).toBeLessThanOrEqual(count); if (from===to) expect(count).toBe(isPolishWorkingDay(from)?1:0); expect(isYearMonth(from.slice(0,7))).toBe(true);
  });
});

describe("HR stress 10000 — koszty i alokacje", () => {
  for (let index = 0; index < 2500; index += 1) it(`scenario ${index + 5001}`, () => {
    const random=rng(40000+index); const allocation=Math.max(1,Math.round(random()*100)); const baseHours=Math.round((1+random()*11)*4)/4; const overtime=Math.round(random()*Math.min(4,24-baseHours)*4)/4; const hourly=Math.round((25+random()*175)*100)/100; const snapshot=Math.round((baseHours+overtime)*hourly*100)/100; const approved=random()>.35; const date=isoFromOffset(210+(index%21));
    const result=calculateLaborControl({month:date.slice(0,7),referenceDate:date,projects:[{id:"p1"}],employments:[{employee_id:"e1",valid_from:"2026-01-01",monthly_cost:hourly*168,hourly_cost:hourly,nominal_monthly_hours:168}],assignments:[{employee_id:"e1",project_id:"p1",date_from:`${date.slice(0,7)}-01`,allocation_percent:allocation}],timesheets:[{employee_id:"e1",project_id:"p1",work_date:date,hours:baseHours,overtime_hours:overtime,status:approved?"approved":"submitted",hourly_cost_snapshot:hourly,labor_cost_snapshot:approved?snapshot:null}],complianceItems:[]});
    expect(result.projects).toHaveLength(1); const employee=result.projects[0]!.employeeCosts[0]!; expect(employee.plannedHours).toBeGreaterThanOrEqual(0); expect(employee.allocationPercent).toBe(allocation); if(approved){expect(employee.actualCost).toBeCloseTo(snapshot,2);expect(employee.approvedHours).toBeCloseTo(baseHours,5);expect(employee.overtimeHours).toBeCloseTo(overtime,5);}else{expect(employee.actualCost).toBe(0);expect(employee.pendingHours).toBeCloseTo(baseHours+overtime,5);}
  });
});

describe("HR stress 10000 — nawigacja i stany UI", () => {
  for (let index=0; index<2500; index+=1) it(`scenario ${index+7501}`,()=>{const random=rng(80000+index);let state:UiState={tab:"dashboard",selectedEmployeeId:null,accountingOpen:false};for(let step=0;step<30;step+=1){const selector=random();if(selector<.5)state=applyUiAction(state,{kind:"tab",tab:TABS[Math.floor(random()*TABS.length)]!});else if(selector<.85)state=applyUiAction(state,{kind:"employee",id:`e${1+Math.floor(random()*25)}`});else state=applyUiAction(state,{kind:"accounting"});expect(TABS).toContain(state.tab);expect(state.selectedEmployeeId===null||/^e\d+$/.test(state.selectedEmployeeId)).toBe(true);expect(typeof state.accountingOpen).toBe("boolean");}const before=state.selectedEmployeeId;const id=before??"e1";const once=applyUiAction(state,{kind:"employee",id});const twice=applyUiAction(once,{kind:"employee",id});expect(twice.selectedEmployeeId).toBe(before);});
});

describe("HR source contracts after audit", () => {
  const formal = readFileSync("components/company/hr/hr-formal-documents-162.tsx", "utf8");
  const documents = readFileSync("components/company/hr/hr-documents-compact-161.tsx", "utf8");
  const wrapper = readFileSync("components/company/hr/hr-workspace-149.tsx", "utf8");
  const accounting = readFileSync("app/api/company/hr/accounting-bridge/route.ts", "utf8");
  const timesheet = readFileSync("app/api/company/hr/timesheet-entry/route.ts", "utf8");
  const intelligence = readFileSync("lib/hr/document-intelligence.ts", "utf8");

  it("connects Uzupełnij to the real HR upload instead of a deleted legacy form", () => { expect(formal).toContain('data-hr-functional-upload="1"'); expect(formal).toContain("trigger.click()"); expect(documents).toContain("HrFormalDocuments162"); expect(formal).not.toContain("scrollToFormalLink"); });
  it("does not run the obsolete mutation observer that moved leave cards in the DOM", () => { expect(wrapper).not.toContain("MutationObserver"); expect(wrapper).not.toContain("insertAdjacentElement"); expect(wrapper).not.toContain("data-hr-leave-inline-host"); });
  it("clips cross-month leave in accounting and treats review as pending", () => { expect(accounting).toContain("leaveDaysInMonth"); expect(accounting).toContain("countPolishWorkingDays(clippedFrom, clippedTo)"); expect(accounting).toContain('["draft", "submitted", "pending", "review"]'); });
  it("keeps WBS ownership, 24h validation and immutable cost fields in the time editor", () => { expect(timesheet).toContain("ownedWbs"); expect(timesheet).toContain("assertTimesheetHours"); expect(timesheet).toContain("labor_cost_snapshot"); expect(timesheet).toContain("ensureUniqueEntry"); });
  it("keeps OCR HR routing cautious and leaves templates outside employee records", () => { expect(intelligence).toContain("processHrDocumentIntake"); expect(intelligence).toContain("Wniosek urlopowy"); expect(intelligence).toMatch(/top\.score\s*<\s*0\.9/); expect(intelligence).toContain("leave_requests"); expect(intelligence).toMatch(/document\.category\s*===\s*["']template["']/); expect(intelligence).toMatch(/employeeNumber\.length\s*>=\s*3/); });
});
