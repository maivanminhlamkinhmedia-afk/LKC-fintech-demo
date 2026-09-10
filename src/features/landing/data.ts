import {
  TrendingUp,
  Shield,
  Users,
  Globe,
  Layers,
  Phone,
  Mail,
  Building2,
  PieChart,
  Coins,
} from 'lucide-react'

export const NAV_LINKS = [
  { label: 'Trang chủ', href: '/' },
  { label: 'Giới thiệu', href: '/gioi-thieu' },
  { label: 'Sản phẩm', href: '/san-pham' },
  { label: 'Góc nhìn TT', href: '/goc-nhin' },
  { label: 'Kiến thức', href: '/kien-thuc' },
  { label: 'Nhà đầu tư', href: '/nha-dau-tu' },
]

export const SLIDES = [
  {
    badge: 'Fintech · Investment · Trust',
    headline: ['ĐỒNG HÀNH TRÊN', 'MỌI HÀNH TRÌNH ĐẦU TƯ'],
    sub: 'Đội ngũ chuyên gia với hơn 10 năm kinh nghiệm — tư vấn chứng khoán, FX và tài sản số minh bạch, hiệu quả.',
    cta: 'Khám phá sản phẩm',
    cta2: 'Tư vấn miễn phí',
    orb1: '#0891B2',
    orb2: '#0AACB5',
  },
  {
    badge: 'Quản lý danh mục · LKC Stock · LKC Crypto Spot',
    headline: ['GIAO VỐN —', 'CHUYÊN GIA LÀM VIỆC'],
    sub: 'Hai danh mục được quản lý chuyên nghiệp: LKC Stock (chứng khoán cơ sở) và LKC Crypto Spot (tài sản số). Báo cáo định kỳ, không ẩn phí.',
    cta: 'Tìm hiểu ngay',
    cta2: 'Xem hiệu suất',
    orb1: '#10B981',
    orb2: '#0FCA9A',
  },
  {
    badge: 'Tư vấn · Cá nhân hóa · Chuyên sâu',
    headline: ['CHIẾN LƯỢC ĐẦU TƯ', 'RIÊNG CHO BẠN'],
    sub: 'Phân tích kỹ thuật & cơ bản chuyên sâu trên 3 thị trường. Lộ trình cá nhân hóa theo mục tiêu và khẩu vị rủi ro.',
    cta: 'Đăng ký tư vấn',
    cta2: 'Góc nhìn thị trường',
    orb1: '#6366F1',
    orb2: '#0AACB5',
  },
]

export const STATS = [
  { value: '10+', label: 'Năm kinh nghiệm', icon: Building2 },
  { value: '1,000+', label: 'Nhà đầu tư tin tưởng', icon: Users },
  { value: '3', label: 'Thị trường đầu tư', icon: Globe },
  { value: '95%', label: 'Tỉ lệ hài lòng', icon: Shield },
]

export const PRODUCTS = [
  {
    icon: TrendingUp,
    title: 'Tư vấn sử dụng hệ thống',
    desc: 'Giải pháp đầu tư cho cá nhân và tổ chức, giải pháp công nghệ đơn giản hoá đầu tư.',
    tags: ['Chứng khoán', 'Hàng hoá phái sinh', 'Tài sản số'],
    color: '#0AACB5',
  },
  {
    icon: Shield,
    title: 'Cho thuê hệ thống',
    desc: '',
    tags: ['Chứng khoán cơ sở', 'Tài sản số'],
    color: '#10B981',
    options: ['Khách hàng tự đầu tư', 'Thuê chuyên gia quản lý'],
  },
  {
    icon: Layers,
    title: 'Môi giới đầu tư',
    desc: '',
    tags: ['Chứng khoán', 'Hàng hoá phái sinh', 'Tài sản số'],
    color: '#6366F1',
    options: [
      'Công ty môi giới hàng hoá phái sinh qua đối tác ICT',
      'Công ty môi giới chứng khoán, cổ phiếu qua VPBankS, DNSE, VPS',
    ],
  },
]

export const ABOUT_CARDS = [
  { icon: TrendingUp, label: 'Chứng khoán', desc: 'HOSE · HNX · UPCOM', color: '#0AACB5' },
  { icon: Globe, label: 'Ngoại hối', desc: 'FX · Vàng · Hàng hóa', color: '#10B981' },
  { icon: Coins, label: 'Crypto', desc: 'BTC · ETH · Altcoin', color: '#6366F1' },
  { icon: PieChart, label: 'Đa tài sản', desc: 'Danh mục cân bằng', color: '#D4A843' },
]

export type Article = {
  id: number
  tab: string
  title: string
  date: string
  market: string
  marketColor: string
  link?: string
}

export const ARTICLES: Article[] = [
  { id: 1, tab: 'Hàng ngày', title: 'Bản tin thị trường sáng 18/05 — Điểm nhấn cần theo dõi', date: '18/05/2026', market: 'Chứng khoán', marketColor: '#0AACB5' },
  { id: 2, tab: 'Hàng ngày', title: 'Crypto Daily: BTC giữ vùng hỗ trợ 95K, ETH tăng nhẹ', date: '18/05/2026', market: 'Crypto', marketColor: '#10B981' },
  { id: 3, tab: 'Hàng tuần', title: 'Nhìn lại tuần 20/2026 — Cơ hội và rủi ro tuần tới', date: '16/05/2026', market: 'Chứng khoán', marketColor: '#0AACB5' },
  { id: 4, tab: 'Hàng tuần', title: 'FX Weekly: USD Index điều chỉnh, cơ hội với EUR/USD', date: '16/05/2026', market: 'FX', marketColor: '#6366F1' },
  { id: 5, tab: 'Hàng tháng', title: 'Báo cáo thị trường T5/2026 — Tổng quan & chiến lược', date: '01/05/2026', market: 'Tổng hợp', marketColor: '#D4A843' },
  { id: 6, tab: 'Hàng quý', title: 'Báo cáo chiến lược Q2/2026 — Phân bổ tài sản tối ưu', date: '01/04/2026', market: 'Tổng hợp', marketColor: '#D4A843' },
]

export const MARKET_TABS = ['Hàng ngày', 'Hàng tuần', 'Hàng tháng', 'Hàng quý']

export const KNOWLEDGE = [
  {
    level: '01',
    title: 'Nhập môn đầu tư',
    desc: 'Dành cho người bắt đầu: hiểu thị trường, chứng khoán cơ sở, chứng khoán phái sinh, hàng hoá phái sinh.',
    items: ['Chứng khoán là gì?', 'Cách đọc biểu đồ cơ bản', 'Đầu tư vs đầu cơ', 'Quản lý rủi ro'],
    count: 12,
    color: '#0AACB5',
  },
  {
    level: '02',
    title: 'Kiến thức thị trường',
    desc: 'Phân tích kỹ thuật, cơ bản và hiểu sâu từng thị trường.',
    items: ['Phân tích kỹ thuật (MA, RSI)', 'Đọc báo cáo tài chính', 'Cơ chế thị trường', 'Blockchain & DeFi'],
    count: 18,
    color: '#10B981',
  },
  {
    level: '03',
    title: 'Chiến lược nâng cao',
    desc: 'Xây dựng danh mục, quản lý vốn và tâm lý giao dịch chuyên nghiệp.',
    items: ['Danh mục đa tài sản', 'Chiến lược DCA', 'Quản lý vốn & tâm lý', 'Thuế và pháp lý'],
    count: 15,
    color: '#6366F1',
  },
]

export const FAQS = [
  { q: 'LKC Fintech có được cấp phép hoạt động không?', a: 'Có. Công ty TNHH Đầu tư LKC Fintech hoạt động theo Giấy chứng nhận đăng ký kinh doanh do Sở KH&ĐT TP. Hà Nội cấp. Mọi hoạt động tuân thủ đầy đủ quy định pháp luật Việt Nam.' },
  { q: 'Vốn tối thiểu để tham gia là bao nhiêu?', a: 'Vốn tối thiểu phụ thuộc vào từng sản phẩm. Vui lòng liên hệ đội ngũ tư vấn để được tư vấn chi tiết và phù hợp với mục tiêu đầu tư của bạn.' },
  { q: 'Phí quản lý được tính như thế nào?', a: 'LKC Fintech áp dụng phí quản lý cố định hàng năm + phí hiệu suất tính trên lợi nhuận vượt benchmark. Chi tiết phí được công bố minh bạch trong hợp đồng dịch vụ.' },
  { q: 'Tôi có thể rút vốn bất cứ lúc nào không?', a: 'Các sản phẩm có thời hạn cam kết tối thiểu (thường 3–6 tháng) để đảm bảo hiệu quả chiến lược đầu tư. Chi tiết sẽ được thỏa thuận rõ trong hợp đồng.' },
  { q: 'LKC Crypto Spot có rủi ro gì?', a: 'Tài sản số có biến động giá cao. LKC Crypto Spot chỉ dùng chiến lược Spot (không đòn bẩy) để kiểm soát rủi ro. Nhà đầu tư cần hiểu rõ rủi ro trước khi tham gia.' },
  { q: 'Làm thế nào để bắt đầu đầu tư với LKC Fintech?', a: 'Liên hệ tư vấn → Tham vấn mục tiêu → Ký hợp đồng → Chuyển vốn và bắt đầu. Toàn bộ quy trình diễn ra trong 1–2 ngày làm việc.' },
  { q: 'LKC Fintech bảo mật thông tin khách hàng như thế nào?', a: 'Thông tin khách hàng được mã hóa và bảo mật theo tiêu chuẩn quốc tế. Chúng tôi cam kết không chia sẻ dữ liệu cá nhân cho bên thứ ba khi chưa có sự đồng ý của khách hàng.' },
  { q: 'Báo cáo hiệu suất được gửi cho tôi như thế nào?', a: 'Báo cáo hiệu suất được gửi qua email và Zalo/Telegram vào cuối mỗi tháng, hoặc theo yêu cầu. Dashboard theo dõi trực tuyến đang phát triển và sẽ ra mắt trong 2026.' },
]

// Các kênh chính thức khách hàng có thể kết nối / theo dõi
export const CONTACT_CHANNELS = [
  {
    id: 'zalo',
    label: 'Zalo',
    desc: 'Tham gia nhóm tư vấn để nhận khuyến nghị & hỗ trợ nhanh nhất.',
    cta: 'Tham gia nhóm Zalo',
    color: '#0068FF',
    groups: [
      { label: 'Chứng khoán cơ sở', href: 'https://zalo.me/g/dyqjyl372' },
      { label: 'Chứng khoán phái sinh', href: 'https://zalo.me/g/wwzeal367' },
    ],
  },
  {
    id: 'facebook',
    label: 'Facebook',
    desc: 'Theo dõi fanpage để cập nhật góc nhìn thị trường mỗi ngày.',
    cta: 'Theo dõi Facebook',
    color: '#1877F2',
    href: 'https://www.facebook.com/share/1CktvB1Qqm/?mibextid=wwXIfr',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    desc: 'Xem video kiến thức đầu tư & phân tích thị trường ngắn gọn.',
    cta: 'Xem trên TikTok',
    color: '#010101',
    href: 'https://www.tiktok.com/@lkcfintech',
  },
]

export const SOCIAL_LINKS = [
  { label: 'Zalo Group', color: '#0068FF' },
  { label: 'Telegram Channel', color: '#0088CC' },
  { label: 'Facebook Group', color: '#1877F2' },
  { label: 'Fanpage LKC Fintech', color: '#1877F2' },
]

export const CONTACT_INFO = [
  { icon: Phone, label: 'Hotline', value: '032.541.3939 / 032.959.3699' },
  { icon: Mail, label: 'Email', value: 'minhmv@lkcfintech.com.vn' },
]

export const COMPANY_INFO = {
  name: 'CÔNG TY TNHH ĐẦU TƯ LKC FINTECH',
  taxCode: '0109898656',
  addresses: [
    { label: 'Trụ sở chính', value: 'Số nhà 16 ngách 36 ngõ 146 đường Trần Phú, Phường Hà Đông, Thành phố Hà Nội, Việt Nam', isHQ: true },
    { label: 'Văn phòng', value: 'Tầng 2, Tòa nhà HH1, 90 Nguyễn Tuân, Thanh Xuân, Hà Nội', isHQ: false },
    { label: 'Chi nhánh', value: 'Số 5b ngõ 55 Huỳnh Thúc Kháng, phường Láng, thành phố Hà Nội', isHQ: false },
  ],
}

export const FLOATING_CONTACTS = [
  {
    id: 'zalo',
    label: 'Zalo',
    tooltip: 'Chat Zalo ngay',
    href: 'https://zalo.me/0000000000',
    color: '#0068FF',
    groups: [
      { label: 'Chứng khoán cơ sở', href: 'https://zalo.me/g/dyqjyl372' },
      { label: 'Chứng khoán phái sinh', href: 'https://zalo.me/g/wwzeal367' },
    ],
  },
  {
    id: 'facebook',
    label: 'Facebook',
    tooltip: 'Facebook LKC Fintech',
    href: 'https://www.facebook.com/share/1CktvB1Qqm/?mibextid=wwXIfr',
    color: '#1877F2',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    tooltip: 'Chat Telegram',
    href: 'https://t.me/lkcfintech',
    color: '#0088CC',
  },
  {
    id: 'email',
    label: 'Email',
    tooltip: 'minhmv@lkcfintech.com.vn',
    href: 'mailto:minhmv@lkcfintech.com.vn',
    color: '#10B981',
  },
  {
    id: 'hotline',
    label: 'Hotline',
    tooltip: '032.541.3939',
    href: 'tel:0325413939',
    color: '#0AACB5',
  },
]
