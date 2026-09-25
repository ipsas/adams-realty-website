import { AgentLinkSelect, RoleSelect } from "@/components/dashboard/lead-controls";
import { PageHeader, Table, Td, Th } from "@/components/dashboard/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getAgentOptions, getUsers } from "@/lib/dashboard/queries";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Users & roles" };

export default async function UsersPage() {
  const actor = await requirePermission("/dashboard/users", can.manageUsers);
  const [rows, agents] = await Promise.all([getUsers(), getAgentOptions()]);
  return (
    <>
      <PageHeader
        title="Users & roles"
        description="Promote a new hire to Agent and link their public profile so their listings and leads show up. Role changes take effect within five minutes."
      />
      <Table>
        <thead>
          <tr>
            <Th>User</Th>
            <Th>Role</Th>
            <Th>Agent profile</Th>
            <Th>Joined</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <Td>
                <p className="font-medium text-ink">{u.name}</p>
                <p className="text-xs">{u.email}</p>
              </Td>
              <Td>
                <RoleSelect
                  userId={u.id}
                  role={u.role}
                  disabled={!can.changeRole(actor, { userId: u.id, role: u.role })}
                />
              </Td>
              <Td>
                {u.role === "user" ? (
                  <span className="text-xs text-faint">—</span>
                ) : (
                  <AgentLinkSelect userId={u.id} agentId={u.agentId} agents={agents} />
                )}
              </Td>
              <Td>{formatDate(u.createdAt)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
