/**
 * File: src/components/admin/LeadershipManagementPanel.tsx
 * Purpose: Super Admin Leadership & Organizational Tier console to view, reorder, add, or promote
 *   Founders, Managing Directors, Directors, Senior Leadership, Department Heads, and Managers.
 * Connected files:
 *   - `src/components/admin/AdminModulesSection.tsx` & `src/pages/EmployeesPage.tsx`
 *   - `src/components/employees/EmployeeFormModal.tsx` (shared add/edit modal)
 *   - `src/pages/TeamsPage.tsx` (renders the public Company Organization / Team Directory hierarchy)
 */
import { Crown, Edit3, Plus } from 'lucide-react'
import { Avatar } from '../ui/Avatar'
import { CategoryBadge, EmployeeStatusBadge } from '../ui/StatusBadge'
import { getDisplayEmployeeId } from '../../lib/orgUtils'
import type { Employee, OrgCategory } from '../../types/database'

interface LeadershipManagementPanelProps {
  employees: Employee[]
  onAddLeader: (defaultCategory: OrgCategory) => void
  onEditMember: (emp: Employee) => void
}

const LEADERSHIP_SLUGS: OrgCategory[] = [
  'founder',
  'managing_director',
  'director',
  'leadership',
  'department_head',
  'manager',
]

export function LeadershipManagementPanel({
  employees,
  onAddLeader,
  onEditMember,
}: LeadershipManagementPanelProps) {
  const leaders = employees
    .filter((e) => LEADERSHIP_SLUGS.includes((e.org_category || 'employee') as OrgCategory))
    .sort((a, b) => (a.display_order ?? 100) - (b.display_order ?? 100) || a.employee_code.localeCompare(b.employee_code))

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold text-[#151722] flex items-center gap-2">
            <Crown className="h-5 w-5 text-[#9C65E5]" />
            Leadership & Hierarchy Management
          </h3>
          <p className="text-xs text-[#6E748C]">
            Curate Founders, Managing Directors, Directors, Department Heads, and Managers shown on Team Directory.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onAddLeader('founder')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" /> Add Founder / MD
          </button>
          <button
            onClick={() => onAddLeader('department_head')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" /> Add Head / Manager
          </button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {leaders.map((leader) => (
          <div
            key={leader.id}
            className="varta-card rounded-[24px] p-4 flex items-start justify-between gap-3 border border-[#E6E8F2]"
          >
            <div className="flex items-start gap-3 min-w-0">
              <Avatar name={leader.full_name} src={leader.avatar_url} size="md" shape="rounded" />
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] font-bold text-[#4D4CEF]">#{leader.display_order}</span>
                  <CategoryBadge category={leader.org_category ?? 'employee'} />
                  {leader.status !== 'active' && <EmployeeStatusBadge status={leader.status} />}
                </div>
                <p className="font-display text-sm font-bold text-[#151722] truncate">{leader.full_name}</p>
                <p className="text-xs font-semibold text-[#4D4CEF] truncate">{leader.designation}</p>
                <p className="text-[11px] text-[#7D839B] truncate">
                  {leader.department?.name || 'Management'}
                  {getDisplayEmployeeId(leader) ? ` • ${getDisplayEmployeeId(leader)}` : ' • Leadership Only'}
                </p>
              </div>
            </div>

            <button
              onClick={() => onEditMember(leader)}
              title="Edit Leadership Profile & Order"
              className="p-2 rounded-full bg-[#F4F5FA] hover:bg-[#4D4CEF]/10 text-[#666C85] hover:text-[#4D4CEF] shrink-0"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {leaders.length === 0 && (
          <div className="sm:col-span-2 lg:col-span-3 p-8 text-center text-xs text-[#8D92A8] bg-[#FAFBFD] rounded-2xl border border-dashed border-[#D6DAE9]">
            No leadership, department head, or manager profiles assigned yet.
          </div>
        )}
      </div>
    </div>
  )
}
