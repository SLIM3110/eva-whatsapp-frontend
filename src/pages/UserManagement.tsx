import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { toUAETime } from '@/lib/uaeTime';
import { Loader2, Eye, EyeOff, Server, Trash2 } from 'lucide-react';

const UserManagement = () => {
  const { user, profile } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Assign Instance modal
  const [instanceTarget, setInstanceTarget] = useState<any>(null);
  const [instanceId, setInstanceId] = useState('');
  const [instanceToken, setInstanceToken] = useState('');
  const [instanceUrl, setInstanceUrl] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [savingInstance, setSavingInstance] = useState(false);

  // Delete account
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    setUsers(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const changeRole = async (userId: string, newRole: string) => {
    const { error } = await supabase.from('profiles').update({ role: newRole as any }).eq('id', userId);
    if (error) toast.error('Failed to update role');
    else {
      await supabase.from('user_roles').delete().eq('user_id', userId);
      await supabase.from('user_roles').insert({ user_id: userId, role: newRole as any });
      toast.success('Role updated');
      fetchData();
    }
  };

  const toggleActive = async (userId: string, currentActive: boolean) => {
    const { error } = await supabase.from('profiles').update({ is_active: !currentActive }).eq('id', userId);
    if (error) toast.error('Failed to update');
    else { toast.success(currentActive ? 'User deactivated' : 'User activated'); fetchData(); }
  };

  const openAssignInstance = (u: any) => {
    setInstanceTarget(u);
    setInstanceId(u.green_api_instance_id || '');
    setInstanceToken(u.green_api_token || '');
    setInstanceUrl(u.green_api_url || '');
    setShowToken(false);
  };

  const saveInstance = async () => {
    if (!instanceTarget) return;
    setSavingInstance(true);
    const { error } = await supabase
      .from('profiles')
      .update({
        green_api_instance_id: instanceId.trim() || null,
        green_api_token: instanceToken.trim() || null,
        green_api_url: instanceUrl.trim() || null,
      } as any)
      .eq('id', instanceTarget.id);

    if (error) {
      toast.error('Failed to save: ' + error.message);
    } else {
      toast.success('Instance assigned — agent can now connect their WhatsApp');
      setInstanceTarget(null);
      fetchData();
    }
    setSavingInstance(false);
  };

  const deleteAccount = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await supabase
        .from('owner_contacts')
        .update({ message_status: 'cancelled' })
        .eq('assigned_agent', deleteTarget.id)
        .eq('message_status', 'pending');

      const { error: profileError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', deleteTarget.id);
      if (profileError) throw new Error(profileError.message);

      const { error: authError } = await supabase.auth.admin.deleteUser(deleteTarget.id);
      if (authError) throw new Error(authError.message);

      setUsers(prev => prev.filter(u => u.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success('Account deleted successfully');
    } catch (err: any) {
      toast.error('Failed to delete account: ' + err.message);
    }
    setDeleting(false);
  };

  const roleBadgeColor = (role: string) => {
    if (role === 'super_admin') return 'bg-accent text-accent-foreground';
    if (role === 'admin') return 'bg-primary text-primary-foreground';
    return 'bg-muted text-muted-foreground';
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin w-8 h-8 text-primary" /></div>;

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>User Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Full Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>WA Instance</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead>Change Role</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {users.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.first_name} {u.last_name}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell><Badge className={roleBadgeColor(u.role)}>{u.role.replace('_', ' ')}</Badge></TableCell>
                    <TableCell>
                      <Switch checked={u.is_active} onCheckedChange={() => toggleActive(u.id, u.is_active)} />
                    </TableCell>
                    <TableCell>
                      {u.green_api_instance_id
                        ? <Badge className="bg-green-600 text-white">Instance Ready</Badge>
                        : <Badge variant="secondary" className="text-muted-foreground">No Instance</Badge>
                      }
                    </TableCell>
                    <TableCell>{u.last_login ? toUAETime(u.last_login) : 'Never'}</TableCell>
                    <TableCell>
                      <Select value={u.role} onValueChange={(val) => changeRole(u.id, val)}>
                        <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="super_admin">Super Admin</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="agent">Agent</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => openAssignInstance(u)}>
                          <Server className="w-3 h-3 mr-1" /> Assign Instance
                        </Button>
                        {isSuperAdmin && u.id !== user?.id && (
                          <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(u)}>
                            <Trash2 className="w-3 h-3 mr-1" /> Delete
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Delete Account Confirmation Modal */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
          </DialogHeader>
          {deleteTarget && (
            <div className="py-2 space-y-3">
              <p className="text-sm">
                Delete <span className="font-semibold">{deleteTarget.first_name} {deleteTarget.last_name}</span>'s account?
                This will permanently remove their profile, cancel all their pending contacts, and cannot be undone.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={deleteAccount} disabled={deleting}>
              {deleting ? <Loader2 className="animate-spin mr-2 w-4 h-4" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Delete Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Instance Modal */}
      <Dialog open={!!instanceTarget} onOpenChange={(open) => { if (!open) setInstanceTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign WhatsApp Instance</DialogTitle>
            {instanceTarget && (
              <p className="text-sm text-muted-foreground mt-1">
                Assigning to: <span className="font-medium">{instanceTarget.first_name} {instanceTarget.last_name}</span>
              </p>
            )}
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="inst-id">Green API Instance ID</Label>
              <Input
                id="inst-id"
                placeholder="e.g. 7105123456"
                value={instanceId}
                onChange={e => setInstanceId(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inst-token">API Token</Label>
              <div className="flex gap-2">
                <Input
                  id="inst-token"
                  type={showToken ? 'text' : 'password'}
                  placeholder="Paste API token here"
                  value={instanceToken}
                  onChange={e => setInstanceToken(e.target.value)}
                />
                <Button variant="ghost" size="icon" type="button" onClick={() => setShowToken(v => !v)}>
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inst-url">API URL</Label>
              <Input
                id="inst-url"
                placeholder="https://XXXX.api.greenapi.com"
                value={instanceUrl}
                onChange={e => setInstanceUrl(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setInstanceTarget(null)}>Cancel</Button>
            <Button onClick={saveInstance} disabled={savingInstance}>
              {savingInstance ? <Loader2 className="animate-spin mr-2 w-4 h-4" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagement;
