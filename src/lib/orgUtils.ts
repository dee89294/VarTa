/**
 * File: src/lib/orgUtils.ts
 * Purpose: Shared organizational helpers enforcing the company `AIPL-(numbers)` Employee ID format and
 *   separating Founding Members (`founder`, `managing_director`) from Employee lists, IDs, and counts.
 * Connected files:
 *   - `src/components/employees/EmployeeFormModal.tsx`
 *   - `src/components/admin/EmployeeManagementPanel.tsx` & `AdminModulesSection.tsx` & `LeadershipManagementPanel.tsx`
 *   - `src/pages/DashboardPage.tsx`, `EmployeesPage.tsx`, `TeamsPage.tsx`, `ScheduleMeetingPage.tsx`, `AttendancePage.tsx`
 */
import type { Employee, OrgCategory } from '../types/database'

export const FOUNDING_CATEGORIES: OrgCategory[] = ['founder', 'managing_director']

export const EMPLOYEE_ID_REGEX = /^AIPL-[0-9]+$/

/** Returns true if this profile belongs to Founding Leadership (excluded from Employee lists/IDs/counts). */
export function isFoundingMember(
  emp?: Pick<Employee, 'org_category' | 'member_category' | 'is_founding_member'> | null
): boolean {
  if (!emp) return false
  if (emp.is_founding_member) return true
  const cat = emp.org_category || emp.member_category
  return cat === 'founder' || cat === 'managing_director'
}

/** Validates the company Employee ID convention (`AIPL-001`, `AIPL-104`, etc.). */
export function isValidAiplEmployeeId(code: string): boolean {
  return EMPLOYEE_ID_REGEX.test(code.trim().toUpperCase())
}

/** Returns the Employee ID string only for actual employees; returns null for Founding Members. */
export function getDisplayEmployeeId(
  emp?: Pick<Employee, 'employee_code' | 'org_category' | 'member_category' | 'is_founding_member'> | null
): string | null {
  if (!emp || isFoundingMember(emp)) return null
  if (!emp.employee_code || emp.employee_code.startsWith('FOUNDER-')) return null
  return emp.employee_code
}

/** Computes the next sequential `AIPL-XXX` Employee ID based on existing employees. */
export function generateNextAiplCode(existingEmployees: Array<Pick<Employee, 'employee_code'>>): string {
  let maxNum = 0
  for (const emp of existingEmployees) {
    const match = (emp.employee_code || '').toUpperCase().match(/^AIPL-(\d+)$/)
    if (match) {
      const n = Number.parseInt(match[1], 10)
      if (Number.isFinite(n) && n > maxNum) maxNum = n
    }
  }
  return `AIPL-${String(maxNum + 1).padStart(3, '0')}`
}
