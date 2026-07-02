'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, X, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { CustomField } from '@/types';

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'number', label: 'Number' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'radio', label: 'Radio' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select (Dropdown)' },
] as const;

export function CustomFieldManager() {
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [fieldToDelete, setFieldToDelete] = useState<CustomField | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    fetchFields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  async function fetchFields() {
    try {
      setLoading(true);

      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'select',
          table: 'custom_fields',
          order: { column: 'created_at', ascending: true },
        }),
      });
      if (!res.ok) throw new Error('Failed to load custom fields');
      const json = await res.json();
      setFields(json.data || []);
    } catch (err) {
      console.error('Failed to fetch custom fields:', err);
      toast.error('Failed to load custom fields');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newFieldName.trim()) {
      toast.error('Field name is required');
      return;
    }

    try {
      setSaving(true);
      if (!user) {
        toast.error('Not authenticated');
        return;
      }

      const values: Record<string, unknown> = {
        user_id: user.id,
        field_name: newFieldName.trim(),
        field_type: newFieldType,
      };

      if ((newFieldType === 'select' || newFieldType === 'radio') && newFieldOptions.trim()) {
        values.field_options = {
          options: newFieldOptions.split(',').map((o) => o.trim()).filter(Boolean),
        };
      }

      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'insert',
          table: 'custom_fields',
          values,
        }),
      });
      if (!res.ok) throw new Error('Failed to create custom field');

      toast.success('Custom field created');
      setDialogOpen(false);
      setNewFieldName('');
      setNewFieldType('text');
      setNewFieldOptions('');
      await fetchFields();
    } catch (err) {
      console.error('Create error:', err);
      toast.error('Failed to create custom field');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(field: CustomField) {
    setFieldToDelete(field);
    setDeleteDialogOpen(true);
  }

  async function handleDelete() {
    if (!fieldToDelete) return;

    try {
      setDeleting(true);
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          table: 'custom_fields',
          filters: [{ column: 'id', operator: 'eq', value: fieldToDelete.id }],
        }),
      });
      if (!res.ok) throw new Error('Failed to delete custom field');

      toast.success('Custom field deleted');
      setFields((prev) => prev.filter((f) => f.id !== fieldToDelete.id));
      setDeleteDialogOpen(false);
      setFieldToDelete(null);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete custom field');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Custom Fields</h2>
          <p className="text-sm text-slate-400">
            Define custom fields to store extra information about your contacts.
          </p>
        </div>
        <Button
          onClick={() => {
            setNewFieldName('');
            setNewFieldType('text');
            setNewFieldOptions('');
            setDialogOpen(true);
          }}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Plus className="size-4" />
          New Field
        </Button>
      </div>

      {fields.length === 0 ? (
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-slate-400 text-sm">No custom fields defined.</p>
            <p className="text-slate-500 text-xs mt-1">
              Create custom fields to store extra information about your contacts.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardContent className="pt-4">
            <div className="space-y-2">
              {fields.map((field) => (
                <div
                  key={field.id}
                  className="group flex items-center justify-between rounded-lg border border-slate-700/50 bg-slate-800/50 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-white">
                      {field.field_name}
                    </span>
                    <span className="rounded-md bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                      {field.field_type}
                    </span>
                    {field.field_type === 'select' &&
                      field.field_options &&
                      Array.isArray((field.field_options as Record<string, unknown>).options) && (
                        <span className="text-xs text-slate-500">
                          {((field.field_options as Record<string, unknown>).options as string[]).join(', ')}
                        </span>
                      )}
                  </div>
                  <button
                    onClick={() => confirmDelete(field)}
                    className="rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10"
                  >
                    <X className="size-4 text-slate-400" />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* New Field Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">New Custom Field</DialogTitle>
            <DialogDescription className="text-slate-400">
              Create a custom field to store extra information about your contacts.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-slate-300">Field Name</Label>
              <Input
                placeholder="e.g. Birthday, Company Size"
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Field Type</Label>
              <Select value={newFieldType} onValueChange={(v) => { if (v) setNewFieldType(v); }}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700 text-white">
                  {FIELD_TYPES.map((ft) => (
                    <SelectItem key={ft.value} value={ft.value}>
                      {ft.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(newFieldType === 'select' || newFieldType === 'radio') && (
              <div className="space-y-2">
                <Label className="text-slate-300">Options</Label>
                <Input
                  placeholder="Option 1, Option 2, Option 3"
                  value={newFieldOptions}
                  onChange={(e) => setNewFieldOptions(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                />
                <p className="text-xs text-slate-500">
                  Comma-separated list of options.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Field'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Delete Custom Field</DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete the field &quot;{fieldToDelete?.field_name}&quot;?
              This will remove all associated values from contacts. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Field'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
