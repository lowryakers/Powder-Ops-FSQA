// Seeded from the Pay Tracking workbook the office kept before this module
// existed. Rates, hire dates and last-increase dates are the numbers that were
// live when it was imported; everything after that is maintained in ReadyDoc.
//
// Salaried staff (Adam, Jake, Marnee) carry no hourly rate — they are on the
// roster for the review clock, not for a rate.
export const PAY_ROSTER = [
  { name: "Maria Servin", team: "Quality", is_supervisor: 1, pay_rate: 23.0, hire_date: "2025-09-09", last_increase_at: "2026-03-30", pto_plan: "4 hr" },
  { name: "Diana Santillan", team: "Quality", is_supervisor: 0, pay_rate: 17.0, hire_date: "2025-04-16", last_increase_at: "2026-04-27", pto_plan: "3 hr" },
  { name: "Daniela Servin", team: "Document", is_supervisor: 1, pay_rate: 21.0, hire_date: "2023-10-16", last_increase_at: "2025-09-09", pto_plan: "4 hr" },
  { name: "Dayanna Meza", team: "Document", is_supervisor: 0, pay_rate: 16.0, hire_date: "2025-06-17", last_increase_at: "2026-04-27", pto_plan: "4 hr" },
  { name: "Juan Gonzalez", team: "Warehouse", is_supervisor: 1, pay_rate: 24.0, hire_date: "2025-02-03", last_increase_at: "2026-02-14", pto_plan: "4 hr" },
  { name: "Danilo Ibanez", team: "Warehouse", is_supervisor: 0, pay_rate: 18.5, hire_date: "2025-06-24", last_increase_at: "2026-02-14", pto_plan: "3 hr" },
  { name: "Ricardo Avalos", team: "Warehouse", is_supervisor: 0, pay_rate: 20.0, hire_date: "2024-08-12", last_increase_at: "2026-05-11", pto_plan: "3 hr" },
  { name: "Zuleika Nava", team: "Cleaning", is_supervisor: 1, pay_rate: 17.0, hire_date: "2024-03-11", last_increase_at: "2025-06-03", pto_plan: "4 hr" },
  { name: "Alicia Meza", team: "Cleaning", is_supervisor: 0, pay_rate: 15.5, hire_date: "2025-11-03", last_increase_at: "2026-04-27", pto_plan: "1099" },
  { name: "Bernardo Enciso", team: "Batching", is_supervisor: 1, pay_rate: 28.0, hire_date: "2025-05-05", last_increase_at: "2026-02-14", pto_plan: "4 hr" },
  { name: "Rene Oporto", team: "Batching", is_supervisor: 0, pay_rate: 19.0, hire_date: "2025-02-01", last_increase_at: "2026-03-16", pto_plan: "3 hr" },
  { name: "Jose Ortiz", team: "Batching", is_supervisor: 0, pay_rate: 20.0, hire_date: "2025-06-02", last_increase_at: "2026-02-14", pto_plan: "3 hr" },
  { name: "Josefa Moy", team: "Stick", is_supervisor: 1, pay_rate: 21.0, hire_date: "2025-04-16", last_increase_at: "2026-01-31", pto_plan: "4 hr" },
  { name: "Maria Fernanda Agudelo", team: "Stick", is_supervisor: 0, pay_rate: 20.0, hire_date: "2024-12-08", last_increase_at: "2026-07-06", pto_plan: "3 hr" },
  { name: "Silvia Carrillo", team: "Stick", is_supervisor: 0, pay_rate: 19.0, hire_date: "2025-08-18", last_increase_at: "2025-08-18", pto_plan: "3 hr" },
  { name: "Rosaura Castro", team: "Stick", is_supervisor: 0, pay_rate: 16.5, hire_date: "2025-02-24", last_increase_at: "2026-04-27", pto_plan: "3 hr" },
  { name: "Sandra Gerez", team: "Stick", is_supervisor: 0, pay_rate: 16.5, hire_date: "2025-06-26", last_increase_at: "2026-07-06", pto_plan: "3 hr" },
  { name: "Olga Olguin", team: "Stick", is_supervisor: 0, pay_rate: 19.0, hire_date: "2025-08-25", last_increase_at: "2025-08-25", pto_plan: "3 hr" },
  { name: "Reina Figueroa", team: "Hand Fill", is_supervisor: 1, pay_rate: 20.0, hire_date: "2025-08-18", last_increase_at: "2025-08-18", pto_plan: "4 hr" },
  { name: "Graciela Leon", team: "Hand Fill", is_supervisor: 0, pay_rate: 17.5, hire_date: "2023-05-01", last_increase_at: "2026-04-27", pto_plan: "4 hr" },
  { name: "Romina Rosales", team: "Hand Fill", is_supervisor: 0, pay_rate: 17.0, hire_date: "2025-02-24", last_increase_at: "2026-04-27", pto_plan: "1099" },
  { name: "Jose Luna", team: "Kitting", is_supervisor: 1, pay_rate: 22.0, hire_date: "2025-07-30", last_increase_at: "2026-01-31", pto_plan: "4 hr" },
  { name: "Elva Espinoza", team: "Kitting", is_supervisor: 0, pay_rate: 17.0, hire_date: "2025-06-18", last_increase_at: "2026-04-27", pto_plan: "3 hr" },
  { name: "Maria Lopez", team: "Kitting", is_supervisor: 0, pay_rate: 16.5, hire_date: "2025-04-16", last_increase_at: "2026-04-27", pto_plan: "3 hr" },
  { name: "Cristina Turci", team: "Hand Fill", is_supervisor: 0, pay_rate: 16.5, hire_date: "2023-10-16", last_increase_at: "2026-04-27", pto_plan: "4 hr" },
  { name: "Adam", team: null, is_supervisor: 0, pay_rate: null, hire_date: "2023-01-01", last_increase_at: "2023-07-24", pto_plan: null },
  { name: "Jake", team: null, is_supervisor: 0, pay_rate: null, hire_date: "2023-01-01", last_increase_at: "2026-03-30", pto_plan: null },
  { name: "Marnee", team: null, is_supervisor: 0, pay_rate: null, hire_date: "2026-01-26", last_increase_at: "2026-05-25", pto_plan: null },
];
