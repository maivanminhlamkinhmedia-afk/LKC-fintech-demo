import { notFound } from 'next/navigation'

export default function ProductDetailPage() {
  // No approved public catalogue producer is connected. All slugs fail closed:
  // do not derive public metadata from C01 staff data or a local product map.
  // A future, separately approved server integration must resolve publication
  // before passing its public DTO to PaidResearchProductDetail.
  notFound()
}
