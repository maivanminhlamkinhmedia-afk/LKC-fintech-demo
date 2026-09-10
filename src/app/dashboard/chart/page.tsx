import { TradingTerminal } from '@/features/chart/TradingTerminal'
import { requirePermission } from '@/lib/authz'

export default async function ChartPage() {
  await requirePermission('chart:use')
  return (
    <section>
      <h1 className="text-3xl font-bold">Biểu đồ & chỉ báo</h1>
      <p className="mt-2 text-slate-500">OpenAlgo Charts được ghép như engine biểu đồ. Hiện dùng dữ liệu demo; bước sau chỉ thay DataFeed bằng API thị trường của LKC.</p>
      <div className="mt-6"><TradingTerminal /></div>
    </section>
  )
}
