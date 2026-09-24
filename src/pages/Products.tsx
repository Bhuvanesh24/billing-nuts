import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Pencil, Plus, Power, Search } from 'lucide-react'
import Modal from '../components/Modal'
import { Badge, btnPrimary, btnSecondary, cardCls, EmptyState, Field, iconBtn, inputCls, LoadingBlock, PageHeader, Spinner, tdCls, thCls } from '../components/ui'
import { createProduct, listProducts, setProductActive, updateProduct } from '../services/masterService'
import { formatINR, formatKg, kgToGrams, parseKgInput } from '../lib/calculator'
import { errorMessage } from '../lib/utils'
import { DEFAULT_GST_RATE, DEFAULT_HSN, PRODUCT_CATEGORIES, SAMPLE_PRODUCTS } from '../config/business'
import { saveRates } from '../services/rateService'
import { todayISO } from '../lib/date'
import type { Product } from '../types'

const GST_RATES = [0, 5, 12, 18]

interface FormState {
  name: string
  category: string
  hsnCode: string
  gstRate: number
  lowStockKg: string
  openingKg: string
}

const emptyForm: FormState = {
  name: '',
  category: PRODUCT_CATEGORIES[0],
  hsnCode: DEFAULT_HSN,
  gstRate: DEFAULT_GST_RATE,
  lowStockKg: '5',
  openingKg: '',
}

export default function Products() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setProducts(await listProducts())
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to load products'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(
      (p) =>
        (showInactive || p.isActive) &&
        (!q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || p.hsnCode.includes(q)),
    )
  }, [products, search, showInactive])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  const openEdit = (p: Product) => {
    setEditing(p)
    setForm({
      name: p.name,
      category: p.category,
      hsnCode: p.hsnCode,
      gstRate: p.gstRate,
      lowStockKg: String(p.lowStockThresholdGrams / 1000),
      openingKg: '',
    })
    setModalOpen(true)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!form.name.trim()) return toast.error('Product name is required')
    const lowStock = parseKgInput(form.lowStockKg || '0')
    if (lowStock === null) return toast.error('Enter a valid low-stock threshold')
    const opening = form.openingKg ? parseKgInput(form.openingKg) : 0
    if (opening === null) return toast.error('Enter a valid opening stock')

    const duplicate = products.find(
      (p) => p.name.trim().toLowerCase() === form.name.trim().toLowerCase() && p.id !== editing?.id,
    )
    if (duplicate) return toast.error(`"${duplicate.name}" already exists`)

    const input = {
      name: form.name,
      category: form.category,
      hsnCode: form.hsnCode,
      gstRate: form.gstRate,
      lowStockThresholdGrams: lowStock,
    }

    setSaving(true)
    try {
      if (editing) {
        await updateProduct(editing.id, input)
        toast.success('Product updated')
      } else {
        await createProduct(input, opening)
        toast.success(opening > 0 ? `Product added with ${formatKg(opening)} kg opening stock` : 'Product added')
      }
      setModalOpen(false)
      await load()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save product'))
    } finally {
      setSaving(false)
    }
  }

  const addSampleProducts = async () => {
    if (saving) return
    setSaving(true)
    try {
      const rows = []
      for (const s of SAMPLE_PRODUCTS) {
        const id = await createProduct(
          { name: s.name, category: s.category, hsnCode: s.hsnCode, gstRate: s.gstRate, lowStockThresholdGrams: 2000 },
          0,
        )
        rows.push({ productId: id, productName: s.name, ratePerKg: s.ratePerKg })
      }
      await saveRates(todayISO(), rows)
      toast.success("Sample products added with today's rates. Add stock from Inventory.")
      await load()
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to add sample products'))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (p: Product) => {
    try {
      await setProductActive(p.id, !p.isActive)
      toast.success(p.isActive ? `${p.name} deactivated` : `${p.name} activated`)
      await load()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Stock is changed only from Inventory and Bills."
        actions={
          <button className={btnPrimary} onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Product
          </button>
        }
      />

      <div className={cardCls}>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className={`${inputCls} pl-9`} placeholder="Search name, category, HSN…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>

        {loading ? (
          <LoadingBlock />
        ) : filtered.length === 0 ? (
          <div>
            <EmptyState title="No products yet" subtitle="Add your first product, or start with the four products from bill No. 701." />
            {products.length === 0 && (
              <div className="-mt-8 pb-10 text-center">
                <button className={btnSecondary} onClick={addSampleProducts} disabled={saving}>
                  {saving && <Spinner />} Add sample products
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={thCls}>Product</th>
                  <th className={thCls}>HSN</th>
                  <th className={thCls}>GST</th>
                  <th className={`${thCls} text-right`}>Stock (kg)</th>
                  <th className={`${thCls} text-right`}>Purchase / kg</th>
                  <th className={`${thCls} text-right`}>Today's Rate</th>
                  <th className={thCls}>Status</th>
                  <th className={`${thCls} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const low = p.stockGrams <= p.lowStockThresholdGrams
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/60">
                      <td className={tdCls}>
                        <p className="font-medium text-slate-900">{p.name}</p>
                        <p className="text-xs text-slate-500">{p.category}</p>
                      </td>
                      <td className={tdCls}>{p.hsnCode}</td>
                      <td className={tdCls}>{p.gstRate}%</td>
                      <td className={`${tdCls} text-right`}>
                        <span className={low ? 'font-semibold text-red-600' : ''}>{formatKg(p.stockGrams)}</span>
                      </td>
                      <td className={`${tdCls} text-right`}>{p.purchaseRate ? formatINR(p.purchaseRate) : '—'}</td>
                      <td className={`${tdCls} text-right`}>{p.currentRate ? formatINR(p.currentRate) : <span className="text-amber-600">Not set</span>}</td>
                      <td className={tdCls}>{p.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                      <td className={`${tdCls} text-right whitespace-nowrap`}>
                        <button className={iconBtn} onClick={() => openEdit(p)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button className={iconBtn} onClick={() => toggleActive(p)} title={p.isActive ? 'Deactivate' : 'Activate'}>
                          <Power className={p.isActive ? 'h-4 w-4' : 'h-4 w-4 text-emerald-600'} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={modalOpen}
        title={editing ? 'Edit Product' : 'Add Product'}
        onClose={() => !saving && setModalOpen(false)}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button className={btnPrimary} type="submit" form="product-form" disabled={saving}>
              {saving && <Spinner />} Save
            </button>
          </>
        }
      >
        <form id="product-form" onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Product name" className="sm:col-span-2">
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Cashew W320" autoFocus />
          </Field>
          <Field label="Category">
            <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="HSN code">
            <input className={inputCls} value={form.hsnCode} onChange={(e) => setForm({ ...form, hsnCode: e.target.value })} />
          </Field>
          <Field label="GST rate">
            <select className={inputCls} value={form.gstRate} onChange={(e) => setForm({ ...form, gstRate: Number(e.target.value) })}>
              {GST_RATES.map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </select>
          </Field>
          <Field label="Low-stock alert (kg)">
            <input className={inputCls} type="number" step="0.001" min="0" inputMode="decimal" value={form.lowStockKg} onChange={(e) => setForm({ ...form, lowStockKg: e.target.value })} />
          </Field>
          {editing ? (
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500 sm:col-span-2">
              Current stock: <b>{formatKg(editing.stockGrams)} kg</b>. Use Inventory → Stock In / Adjust to change stock.
            </p>
          ) : (
            <Field label="Opening stock (kg)" hint="Entered once. Recorded in the stock ledger as an 'IN' movement." className="sm:col-span-2">
              <input
                className={inputCls}
                type="number"
                step="0.001"
                min="0"
                inputMode="decimal"
                placeholder="0.000"
                value={form.openingKg}
                onChange={(e) => setForm({ ...form, openingKg: e.target.value })}
              />
              {form.openingKg && parseKgInput(form.openingKg) !== null && (
                <span className="mt-1 block text-xs text-slate-500">= {kgToGrams(Number(form.openingKg)).toLocaleString('en-IN')} g</span>
              )}
            </Field>
          )}
        </form>
      </Modal>
    </div>
  )
}
