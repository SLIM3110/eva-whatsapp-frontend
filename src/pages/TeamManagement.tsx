import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Users } from 'lucide-react';

const TeamManagement = () => {
  const [agents, setAgents]   = useState<any[]>([]);
  const [admins, setAdmins]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, role, admin_id, is_active')
      .order('first_name');

    const all = data || [];
    setAgents(all.filter((p: any) => p.role === 'agent'));
    setAdmins(all.filter((p: any) => p.role === 'admin' || p.role === 'super_admin'));
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const assignAdmin = async (agentId: string, adminId: string) => {
    const val = adminId === 'none' ? null : adminId;
    const { error } = await supabase.from('profiles').update({ admin_id: val } as any).eq('id', agentId);
    if (error) {
      toast.error('Failed to assign admin');
    } else {
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, admin_id: val } : a));
      toast.success('Agent assigned');
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="animate-spin w-8 h-8 text-primary" />
    </div>
  );

  const agentCountByAdmin = admins.reduce<Record<string, number>>((acc, adm) => {
    acc[adm.id] = agents.filter(a => a.admin_id === adm.id).length;
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      {/* Section 1 — Assign Agents to Admins */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" /> Assign Agents to Admins
          </CardTitle>
        </CardHeader>
        <CardContent>
          {agents.length === 0 ? (
            <p className="text-muted-foreground text-sm">No agents found.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned Admin</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {agents.map(agent => (
                    <TableRow key={agent.id}>
                      <TableCell className="font-medium">
                        {agent.first_name} {agent.last_name}
                      </TableCell>
                      <TableCell>
                        <Badge className={agent.is_active ? 'bg-green-600 text-white' : 'bg-gray-400 text-white'}>
                          {agent.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={agent.admin_id || 'none'}
                          onValueChange={val => assignAdmin(agent.id, val)}
                        >
                          <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="Unassigned" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Unassigned</SelectItem>
                            {admins.map(adm => (
                              <SelectItem key={adm.id} value={adm.id}>
                                {adm.first_name} {adm.last_name}
                                {adm.role === 'super_admin' ? ' (Super Admin)' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 2 — Team Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Team Overview</CardTitle>
        </CardHeader>
        <CardContent>
          {admins.length === 0 ? (
            <p className="text-muted-foreground text-sm">No admins found.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Admin</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Agents Assigned</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {admins.map(adm => (
                    <TableRow key={adm.id}>
                      <TableCell className="font-medium">
                        {adm.first_name} {adm.last_name}
                      </TableCell>
                      <TableCell>
                        <Badge className={adm.role === 'super_admin' ? 'bg-accent text-accent-foreground' : 'bg-primary text-primary-foreground'}>
                          {adm.role.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold">{agentCountByAdmin[adm.id] ?? 0}</span>
                        <span className="text-muted-foreground text-sm ml-1">
                          {agentCountByAdmin[adm.id] === 1 ? 'agent' : 'agents'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TeamManagement;
