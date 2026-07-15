'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { CustomField, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Users,
  Tags,
  Filter,
  Upload,
  Loader2,
  ArrowRight,
  ArrowLeft,
  X,
  FileText,
} from 'lucide-react';

type AudienceType = 'all' | 'tags' | 'custom_field' | 'csv';
type CustomFieldOperator = 'is' | 'is_not' | 'contains';

interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

interface AudienceConfig {
  type: AudienceType;
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  excludeTagIds?: string[];
}

interface Step2Props {
  audience: AudienceConfig;
  onUpdate: (audience: AudienceConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

const audienceOptions: {
  type: AudienceType;
  label: string;
  description: string;
  icon: typeof Users;
}[] = [
  {
    type: 'all',
    label: 'All Contacts',
    description: 'Send to every contact in your database',
    icon: Users,
  },
  {
    type: 'tags',
    label: 'Filter by Tags',
    description: 'Target contacts with specific tags',
    icon: Tags,
  },
  {
    type: 'custom_field',
    label: 'Custom Field',
    description: 'Filter by a custom field value',
    icon: Filter,
  },
  {
    type: 'csv',
    label: 'Upload CSV',
    description: 'Upload a list of phone numbers',
    icon: Upload,
  },
];

const OPERATOR_OPTIONS: { value: CustomFieldOperator; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'contains', label: 'contains' },
];

export function Step2SelectAudience({
  audience,
  onUpdate,
  onNext,
  onBack,
}: Step2Props) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [csvFileName, setCsvFileName] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);

  // Tags are used both by the primary "Filter by Tags" audience type
  // AND by the exclude-list below — so always load once on mount.
  useEffect(() => {
    async function fetchTags() {
      setLoadingTags(true);
      try {
        const res = await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'select',
            table: 'tags',
            order: { column: 'name' },
          }),
        });
        if (res.ok) {
          const json = await res.json();
          setTags(json.data ?? []);
        }
      } finally {
        setLoadingTags(false);
      }
    }
    fetchTags();
  }, []);

  // Lazy-load custom fields only when that audience type is active.
  useEffect(() => {
    if (audience.type !== 'custom_field') return;
    async function fetchFields() {
      setLoadingFields(true);
      try {
        const res = await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'select',
            table: 'custom_fields',
            order: { column: 'field_name' },
          }),
        });
        if (res.ok) {
          const json = await res.json();
          setCustomFields(json.data ?? []);
        }
      } finally {
        setLoadingFields(false);
      }
    }
    fetchFields();
  }, [audience.type]);

  async function fetchTagContactIds(tagIds: string[]): Promise<Set<string>> {
    const allIds: string[] = [];
    let page = 0;
    const PAGE = 5000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'select',
          table: 'contact_tags',
          select: 'contact_id',
          filters: [{ column: 'tag_id', operator: 'in', value: tagIds }],
          limit: PAGE,
          offset: page * PAGE,
        }),
      });
      if (!res.ok) {
        console.error('Failed to fetch contact_tags:', res.status);
        break;
      }
      const json = await res.json();
      const batch = json.data ?? [];
      allIds.push(...batch.map((r: { contact_id: string }) => r.contact_id).filter(Boolean));
      if (batch.length < PAGE) break;
      page++;
    }
    return new Set(allIds);
  }

  async function verifyContactIds(ids: Set<string>): Promise<Set<string>> {
    if (ids.size === 0) return ids;
    const idArray = [...ids];
    const verifiedIds: string[] = [];
    let vPage = 0;
    const V_PAGE = 5000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const start = vPage * V_PAGE;
      const slice = idArray.slice(start, start + V_PAGE);
      if (slice.length === 0) break;
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'select',
          table: 'contacts',
          select: 'id',
          filters: [{ column: 'id', operator: 'in', value: slice }],
          skipUserFilter: true,
        }),
      });
      if (!res.ok) break;
      const json = await res.json();
      const batch = json.data ?? [];
      verifiedIds.push(...batch.map((c: { id: string }) => c.id));
      if (batch.length < V_PAGE) break;
      vPage++;
    }
    return new Set(verifiedIds);
  }

  const fetchEstimatedCount = useCallback(async () => {
    const reqId = ++requestIdRef.current;
    setLoadingCount(true);
    try {
      const hasExcludeTags =
        audience.excludeTagIds && audience.excludeTagIds.length > 0;

      // CSV: just use the parsed row count
      if (
        audience.type === 'csv' &&
        audience.csvContacts &&
        audience.csvContacts.length > 0
      ) {
        setEstimatedCount(audience.csvContacts.length);
        return;
      }

      // "All Contacts": use count endpoint (no need to fetch rows)
      if (audience.type === 'all') {
        const res = await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'select',
            table: 'contacts',
            count: true,
            head: true,
            skipUserFilter: true,
          }),
        });
        if (reqId !== requestIdRef.current) return;
        if (res.ok) {
          const json = await res.json();
          const total = json.count ?? 0;
          if (hasExcludeTags) {
            const exIds = await fetchTagContactIds(audience.excludeTagIds!);
            const verifiedEx = await verifyContactIds(exIds);
            setEstimatedCount(Math.max(0, total - verifiedEx.size));
          } else {
            setEstimatedCount(total);
          }
        } else {
          console.error('Failed to count contacts:', res.status);
          setEstimatedCount(0);
        }
        return;
      }

      // Tag-based filter
      if (
        audience.type === 'tags' &&
        audience.tagIds &&
        audience.tagIds.length > 0
      ) {
        const baseIds = await fetchTagContactIds(audience.tagIds);
        const verifiedBase = await verifyContactIds(baseIds);
        if (hasExcludeTags) {
          const exIds = await fetchTagContactIds(audience.excludeTagIds!);
          const verifiedEx = await verifyContactIds(exIds);
          const effective = [...verifiedBase].filter((id) => !verifiedEx.has(id));
          setEstimatedCount(effective.length);
        } else {
          setEstimatedCount(verifiedBase.size);
        }
        return;
      }

      // Custom field filter
      if (
        audience.type === 'custom_field' &&
        audience.customField?.fieldId &&
        audience.customField.value
      ) {
        const { fieldId, operator, value } = audience.customField;
        const op = operator === 'contains' ? 'ilike' : operator === 'is_not' ? 'neq' : 'eq';
        const val = operator === 'contains' ? `%${value}%` : value;
        const res = await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'select',
            table: 'contact_custom_values',
            select: 'contact_id',
            filters: [
              { column: 'custom_field_id', operator: 'eq', value: fieldId },
              { column: 'value', operator: op, value: val },
            ],
          }),
        });
        if (reqId !== requestIdRef.current) return;
        if (res.ok) {
          const json = await res.json();
          const baseIds = new Set<string>(
            (json.data ?? []).map((r: { contact_id: string }) => r.contact_id),
          );
          const verifiedBase = await verifyContactIds(baseIds);
          if (hasExcludeTags) {
            const exIds = await fetchTagContactIds(audience.excludeTagIds!);
            const verifiedEx = await verifyContactIds(exIds);
            const effective = [...verifiedBase].filter(
              (id) => !verifiedEx.has(id),
            );
            setEstimatedCount(effective.length);
          } else {
            setEstimatedCount(verifiedBase.size);
          }
        } else {
          console.error('Failed to count custom field matches:', res.status);
          setEstimatedCount(0);
        }
        return;
      }

      // No valid selection yet
      setEstimatedCount(null);
    } finally {
      if (reqId === requestIdRef.current) setLoadingCount(false);
    }
  }, [
    audience.type,
    audience.tagIds,
    audience.customField,
    audience.csvContacts,
    audience.excludeTagIds,
  ]);

  useEffect(() => {
    fetchEstimatedCount();
  }, [fetchEstimatedCount]);

  function toggleTag(tagId: string) {
    const current = audience.tagIds ?? [];
    const isAdding = !current.includes(tagId);
    const updated = isAdding
      ? [...current, tagId]
      : current.filter((id) => id !== tagId);
    // Prevent same tag in both include and exclude
    const excludeUpdated = isAdding
      ? (audience.excludeTagIds ?? []).filter((id) => id !== tagId)
      : audience.excludeTagIds;
    onUpdate({ ...audience, tagIds: updated, excludeTagIds: excludeUpdated });
  }

  function toggleExcludeTag(tagId: string) {
    const current = audience.excludeTagIds ?? [];
    const isAdding = !current.includes(tagId);
    const updated = isAdding
      ? [...current, tagId]
      : current.filter((id) => id !== tagId);
    // Prevent same tag in both include and exclude
    const includeUpdated = isAdding
      ? (audience.tagIds ?? []).filter((id) => id !== tagId)
      : audience.tagIds;
    onUpdate({ ...audience, excludeTagIds: updated, tagIds: includeUpdated });
  }

  function updateCustomField(patch: Partial<CustomFieldFilter>) {
    const prev = audience.customField ?? {
      fieldId: '',
      operator: 'is' as CustomFieldOperator,
      value: '',
    };
    onUpdate({ ...audience, customField: { ...prev, ...patch } });
  }

  function parseCSV(text: string): { phone: string; name?: string }[] {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/["']/g, ''));
    const phoneIdx = headers.indexOf('phone');
    if (phoneIdx === -1) return [];

    const nameIdx = headers.indexOf('name');

    const rows: { phone: string; name?: string }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values: string[] = [];
      let current = '';
      let inQuotes = false;
      for (const char of line) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());

      const phone = values[phoneIdx]?.replace(/["']/g, '').trim();
      if (!phone) continue;

      rows.push({
        phone,
        name: nameIdx >= 0 ? values[nameIdx]?.replace(/["']/g, '').trim() || undefined : undefined,
      });
    }

    return rows;
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setCsvFileName(file.name);

    try {
      const text = await file.text();
      const rows = parseCSV(text);
      onUpdate({ ...audience, csvContacts: rows });
    } catch {
      setCsvFileName('');
    } finally {
      setIsParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function clearCsv() {
    setCsvFileName('');
    onUpdate({ ...audience, csvContacts: [] });
  }

  const isValid =
    audience.type === 'all' ||
    (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) ||
    (audience.type === 'custom_field' &&
      !!audience.customField?.fieldId &&
      audience.customField.value.length > 0) ||
    (audience.type === 'csv' &&
      audience.csvContacts &&
      audience.csvContacts.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Select Audience</h2>
        <p className="mt-1 text-sm text-slate-400">
          Choose who will receive this broadcast.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {audienceOptions.map((option) => {
          const isSelected = audience.type === option.type;
          const Icon = option.icon;
          return (
            <button
              key={option.type}
              onClick={() =>
                onUpdate({
                  ...audience,
                  type: option.type,
                  // Wipe shape fields from other types to avoid stale
                  // config leaking across selections.
                  tagIds: option.type === 'tags' ? audience.tagIds : undefined,
                  customField:
                    option.type === 'custom_field'
                      ? audience.customField
                      : undefined,
                  csvContacts:
                    option.type === 'csv' ? audience.csvContacts : undefined,
                })
              }
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  isSelected
                    ? 'bg-primary/10 text-primary'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">{option.label}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {option.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {audience.type === 'csv' && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <p className="mb-3 text-sm font-medium text-white">Upload CSV</p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />

          {csvFileName ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                <FileText className="h-5 w-5 text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-white">{csvFileName}</p>
                  <p className="text-xs text-slate-400">
                    {isParsing
                      ? 'Parsing…'
                      : `${(audience.csvContacts ?? []).length} contacts found`}
                  </p>
                </div>
                <button
                  onClick={clearCsv}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-lg border border-dashed border-slate-700 px-4 py-2 text-sm text-slate-400 transition-colors hover:border-primary/40 hover:text-primary"
              >
                Replace file
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isParsing}
              className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-slate-700 px-4 py-8 text-sm text-slate-400 transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
            >
              {isParsing ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <>
                  <Upload className="h-6 w-6" />
                  <span>Click to choose a CSV file</span>
                  <span className="text-xs text-slate-500">
                    Must have a &quot;phone&quot; column header
                  </span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {audience.type === 'tags' && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <p className="mb-3 text-sm font-medium text-white">Select Tags</p>
          {loadingTags ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : tags.length === 0 ? (
            <p className="text-xs text-slate-400">
              No tags found. Create tags in Settings.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const isSelected = audience.tagIds?.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <span
                      className="mr-1.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {audience.type === 'custom_field' && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <p className="text-sm font-medium text-white">Custom Field Filter</p>
          {loadingFields ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : customFields.length === 0 ? (
            <p className="text-xs text-slate-400">
              No custom fields defined. Create one in Settings → Custom Fields.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]">
              <select
                value={audience.customField?.fieldId ?? ''}
                onChange={(e) => updateCustomField({ fieldId: e.target.value })}
                className="h-9 rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Select field…</option>
                {customFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.field_name}
                  </option>
                ))}
              </select>
              <select
                value={audience.customField?.operator ?? 'is'}
                onChange={(e) =>
                  updateCustomField({
                    operator: e.target.value as CustomFieldOperator,
                  })
                }
                className="h-9 rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                {OPERATOR_OPTIONS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={audience.customField?.value ?? ''}
                onChange={(e) => updateCustomField({ value: e.target.value })}
                placeholder="Value"
                className="h-9 rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          )}
        </div>
      )}

      {/* Exclude list — applies regardless of audience type */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <X className="h-4 w-4 text-red-400" />
          <p className="text-sm font-medium text-white">
            Exclude contacts with these tags
          </p>
          <span className="text-xs text-slate-500">(optional)</span>
        </div>
        {tags.length === 0 ? (
          <p className="text-xs text-slate-500">No tags available.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const isExcluded = audience.excludeTagIds?.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleExcludeTag(tag.id)}
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                    isExcluded
                      ? 'border-red-500/30 bg-red-500/10 text-red-300'
                      : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <span
                    className="mr-1.5 h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Audience Summary */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p className="mb-2 text-sm font-medium text-white">Audience Summary</p>
        {loadingCount ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-xs text-slate-400">Calculating…</span>
          </div>
        ) : estimatedCount !== null ? (
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm text-white">
              {estimatedCount.toLocaleString()}
            </span>
            <span className="text-xs text-slate-400">estimated recipients</span>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Select an audience type to see the estimate.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-800 pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-slate-700 text-slate-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Next
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
