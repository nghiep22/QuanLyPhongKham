export type NewsCategory = 'Hướng dẫn' | 'Dịch vụ' | 'Hồ sơ'

export type NewsArticle = {
  slug: string
  category: NewsCategory
  title: string
  excerpt: string
  lead: string
  readMinutes: number
  symbol: string
  tone: 'mint' | 'peach' | 'sky' | 'lilac' | 'gold'
  image: string
  sections: { title: string; text: string; items?: string[] }[]
  action: { label: string; to: string }
}

export type HealthVideo = {
  youtubeId: string
  title: string
  publisher: string
  description: string
}

export const healthVideos: HealthVideo[] = [
  {
    youtubeId: '_UEVndsldCM',
    title: 'Rửa tay đúng cách để phòng bệnh',
    publisher: 'Bộ Y tế',
    description: 'Hướng dẫn những bước rửa tay giúp giữ vệ sinh cho bản thân và gia đình.',
  },
  {
    youtubeId: 'kBvuYYokSRA',
    title: 'Khám sức khỏe định kỳ cho cả gia đình',
    publisher: 'Báo Sức khỏe & Đời sống',
    description: 'Tìm hiểu vai trò của việc kiểm tra sức khỏe định kỳ và chăm sóc chủ động.',
  },
  {
    youtubeId: '5tK1xkOTFwU',
    title: 'Bác sĩ hướng dẫn cách phòng ngừa ung thư',
    publisher: 'Báo Sức khỏe & Đời sống',
    description: 'Những thông tin sức khỏe thường thức được bác sĩ chia sẻ qua video.',
  },
]

// Editorial content for the patient portal. Keep articles tied to features that exist in this app.
export const newsArticles: NewsArticle[] = [
  {
    slug: 'dat-lich-kham-truc-tuyen', category: 'Hướng dẫn',
    title: 'Đặt lịch khám trực tuyến, từng bước một',
    excerpt: 'Từ chọn dịch vụ đến xác nhận khung giờ: những bước cơ bản để chủ động sắp xếp buổi khám.',
    lead: 'Bạn có thể xem dịch vụ, bác sĩ và thời gian còn trống trước khi gửi yêu cầu đặt lịch trên cổng bệnh nhân.',
    readMinutes: 3, symbol: '▦', tone: 'mint',
    image: '/images/clinic-guidance.webp',
    sections: [
      { title: 'Bắt đầu từ nhu cầu của bạn', text: 'Mở mục Khám phá để xem danh mục dịch vụ, chuyên khoa, bác sĩ và chi nhánh. Trang chi tiết dịch vụ hiển thị thông tin cần thiết để bạn cân nhắc trước khi đặt hẹn.' },
      { title: 'Chọn thông tin cho lịch hẹn', text: 'Tại trang Đặt lịch, hãy chọn hồ sơ bệnh nhân, dịch vụ, bác sĩ và thời gian phù hợp. Kiểm tra lại các lựa chọn trên màn hình trước khi xác nhận.', items: ['Chọn đúng người đi khám nếu bạn quản lý nhiều hồ sơ.', 'Xem lại chi nhánh và khung giờ đã chọn.', 'Theo dõi trạng thái lịch hẹn trong mục Lịch khám.'] },
      { title: 'Sau khi gửi yêu cầu', text: 'Lịch hẹn sẽ xuất hiện trong tài khoản để bạn tiện theo dõi. Nếu cần thay đổi kế hoạch, hãy mở lại chi tiết lịch hẹn và sử dụng các thao tác được hiển thị ở đó.' },
    ],
    action: { label: 'Bắt đầu đặt lịch', to: '/booking' },
  },
  {
    slug: 'chon-dich-vu-phu-hop', category: 'Dịch vụ',
    title: 'Tìm hiểu dịch vụ và bảng giá trước khi đặt hẹn',
    excerpt: 'Tra cứu danh mục theo chi nhánh để có cái nhìn rõ hơn về dịch vụ, thời lượng và chi phí hiển thị.',
    lead: 'Danh mục công khai giúp bạn tham khảo những lựa chọn hiện có tại từng cơ sở trước khi quyết định đặt lịch.',
    readMinutes: 3, symbol: '✳', tone: 'peach',
    image: '/images/clinic-services.webp',
    sections: [
      { title: 'Tìm bằng tên hoặc nhóm dịch vụ', text: 'Từ trang chủ hoặc Khám phá, nhập tên dịch vụ cần tìm. Bạn cũng có thể xem theo chuyên khoa và chi nhánh để thu hẹp danh sách.' },
      { title: 'Đọc thông tin ở trang chi tiết', text: 'Mỗi dịch vụ có trang riêng để xem mô tả, thời lượng và giá hiển thị tại chi nhánh đã chọn. Hãy kiểm tra cơ sở trước khi chuyển sang bước đặt lịch.' },
      { title: 'Khi chưa biết nên chọn gì', text: 'Bạn có thể xem hồ sơ bác sĩ và danh sách chuyên khoa để hiểu thêm các lựa chọn. Thông tin trên cổng chỉ hỗ trợ tra cứu; nếu cần tư vấn chuyên môn, hãy trao đổi trực tiếp với nhân viên y tế.' },
    ],
    action: { label: 'Xem dịch vụ & bảng giá', to: '/explore?view=services' },
  },
  {
    slug: 'xem-ket-qua-kham', category: 'Hướng dẫn',
    title: 'Xem lại kết quả khám trong tài khoản',
    excerpt: 'Một cách thuận tiện để tìm lại hồ sơ đã được công bố và theo dõi thông tin sau buổi khám.',
    lead: 'Khi kết quả được công bố cho tài khoản của bạn, mục Kết quả khám giúp bạn mở lại thông tin cần xem.',
    readMinutes: 2, symbol: '◇', tone: 'sky',
    image: '/images/clinic-results.webp',
    sections: [
      { title: 'Mở đúng hồ sơ', text: 'Đăng nhập, vào mục Kết quả khám và chọn hồ sơ bệnh nhân liên kết. Danh sách sẽ hiển thị những kết quả mà tài khoản của bạn có quyền xem.' },
      { title: 'Xem thông tin theo từng lần khám', text: 'Mở một mục trong danh sách để đọc nội dung đã được công bố. Nếu bạn quản lý hồ sơ cho người thân, hãy chú ý tên bệnh nhân và ngày khám để tránh nhầm lẫn.' },
      { title: 'Nếu chưa thấy kết quả', text: 'Kết quả chỉ xuất hiện khi đã được hoàn tất và công bố. Bạn có thể kiểm tra lại sau hoặc liên hệ trực tiếp với cơ sở khám để được hỗ trợ.' },
    ],
    action: { label: 'Đi tới kết quả khám', to: '/records' },
  },
  {
    slug: 'ho-so-nguoi-than', category: 'Hồ sơ',
    title: 'Theo dõi lịch khám cho người thân dễ dàng hơn',
    excerpt: 'Liên kết hồ sơ phù hợp để đặt lịch và xem thông tin được cấp quyền trong cùng một tài khoản.',
    lead: 'Cổng bệnh nhân hỗ trợ quản lý hồ sơ được liên kết với tài khoản, giúp bạn chọn đúng người khi thực hiện các thao tác.',
    readMinutes: 3, symbol: '♡', tone: 'lilac',
    image: '/images/clinic-family.webp',
    sections: [
      { title: 'Kiểm tra hồ sơ đã liên kết', text: 'Vào mục Hồ sơ để xem những người đang được liên kết với tài khoản. Tên và mối quan hệ được hiển thị để bạn dễ nhận biết.' },
      { title: 'Chọn người đi khám khi đặt lịch', text: 'Ở bước đặt lịch, chọn đúng hồ sơ bệnh nhân trước khi tiếp tục chọn dịch vụ và thời gian. Việc kiểm tra lại thông tin này giúp lịch hẹn gắn với đúng người.' },
      { title: 'Quyền xem thông tin', text: 'Thông tin khám và kết quả chỉ được hiển thị theo quyền của tài khoản. Nếu chưa thấy hồ sơ cần dùng, hãy mở trang Hồ sơ để xem hướng dẫn liên kết tại đó.' },
    ],
    action: { label: 'Quản lý hồ sơ', to: '/profiles' },
  },
  {
    slug: 'tim-chi-nhanh-thuan-tien', category: 'Dịch vụ',
    title: 'Chọn chi nhánh thuận tiện cho buổi khám',
    excerpt: 'Xem danh sách cơ sở và những dịch vụ liên quan trước khi quyết định thời gian khám.',
    lead: 'Mỗi chi nhánh có danh mục dịch vụ và lịch hẹn riêng. Bắt đầu từ cơ sở phù hợp sẽ giúp bạn tra cứu nhanh hơn.',
    readMinutes: 2, symbol: '⌂', tone: 'gold',
    image: '/images/clinic-branch.webp',
    sections: [
      { title: 'Xem danh sách cơ sở', text: 'Trong mục Khám phá, chuyển sang thẻ Chi nhánh để xem những cơ sở đang có trong danh mục công khai.' },
      { title: 'Đối chiếu dịch vụ và lịch', text: 'Mở trang chi tiết chi nhánh để xem các dịch vụ liên quan. Khi đặt lịch, hãy kiểm tra lại chi nhánh đã chọn cùng khung giờ trước khi xác nhận.' },
      { title: 'Lưu ý trước khi đến', text: 'Hãy xem lại chi tiết lịch hẹn trong tài khoản để chắc chắn bạn đến đúng cơ sở và đúng thời gian.' },
    ],
    action: { label: 'Xem các chi nhánh', to: '/explore?view=branches' },
  },
]
