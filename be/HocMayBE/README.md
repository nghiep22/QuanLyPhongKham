# Công cụ tìm kiếm bài viết theo nội dung

Backend TypeScript cho Project 02: tìm kiếm bài đăng của 20 Newsgroups bằng TF–IDF và cosine. Ứng dụng chạy độc lập với hệ thống phòng khám; không đọc SQL hay hồ sơ bệnh nhân.

## Yêu cầu

- Node.js 24 trở lên, npm 11 trở lên, lệnh `tar` trong PATH.
- Kết nối mạng khi tải dữ liệu lần đầu.
- Frontend nằm tại `fe/HocMayFE`.

## Chạy từ máy mới

```powershell
cd be/HocMayBE
npm ci
npm run pipeline
npm run dev
```

API chạy ở `http://localhost:4003`. Pipeline gồm ba bước có thể chạy riêng: `npm run data:prepare`, `npm run train`, `npm run evaluate`. Ứng dụng phục vụ chỉ đọc `models/search-index.json`; không fit lại TF–IDF khi nhận request.

## API

`GET /api/search?q=space%20shuttle&k=5&category=sci.space`

```json
{
  "data": [{
    "id": "train/sci.space/12345",
    "category": "sci.space",
    "score": 0.42,
    "snippet": "...",
    "contributingTerms": [{ "term": "space", "contribution": 0.12 }]
  }],
  "meta": { "query": "space shuttle", "k": 5, "category": "sci.space", "count": 1, "responseMs": 1.2, "warning": null }
}
```

`q` cần 2–200 ký tự; `k` là số nguyên 1–50; `category` phải là chủ đề đã lập chỉ mục. API trả 400 cho tham số sai, 503 khi chưa có model, 404 cho đường dẫn không tồn tại. Các endpoint khác: `GET /api/meta`, `GET /api/evaluation`, `GET /api/health`.

## Phương pháp và đánh giá

- Baseline: đếm số từ truy vấn xuất hiện trong từng bài.
- TF–IDF: tần suất từ nhân IDF trơn `log((1+N)/(1+df))+1`, chuẩn hóa L2; cosine là tích vô hướng của hai vector đã chuẩn hóa.
- Bốn biến thể: unigram; unigram + bigram; thay đổi `minDf`; thay đổi cả `minDf`/`maxDf`. Cùng split, cùng truy vấn và cùng metric.
- Validation: 25 bài mỗi chủ đề, dùng 18 từ đầu sau làm sạch làm truy vấn ngắn; chọn mô hình bằng Precision@5 rồi MRR. Bộ 32 truy vấn tự xây được báo riêng.
- Test: 25 bài mỗi chủ đề từ split by-date chính thức, chỉ chạy sau khi chọn cấu hình. Relevance là cùng nhãn chủ đề; báo Precision@5, MRR, độ trễ, lỗi theo chủ đề.
- Kết quả, biểu đồ và model card nằm trong `reports/`. `data/processed/quality.json` ghi chất lượng dữ liệu và số dòng bị loại.

## Tệp bàn giao theo đề

- `reports/bao-cao-tfidf.docx` và `reports/bao-cao-tfidf.pdf`: báo cáo 18 trang; bản nội dung có thể sửa nằm ở `reports/bao-cao-noi-dung.md`.
- `reports/trinh-bay-tfidf-final.pptx`: 11 slide, có biểu đồ chỉnh sửa được.
- `reports/results.json`, `reports/validation.json`, `reports/figures/`: số liệu và biểu đồ của lần chạy hiện tại.
- `reports/nhat-ky-va-phan-cong.md`: mẫu ghi sáu tuần và đóng góp hai thành viên.

Trước khi nộp, nhóm điền tên, mã sinh viên, phân công, nhật ký có bằng chứng và khai báo công cụ AI theo quá trình thực tế. Các mục này được để trống vì repo không cung cấp thông tin để xác thực.

Kết quả có thể thay đổi theo phần cứng và phiên bản Node; seed và checksum đã cố định. Không coi điểm cosine là xác suất hoặc mức hiểu ngữ nghĩa. Bộ dữ liệu là tiếng Anh cũ; không dùng trực tiếp để tư vấn lâm sàng hoặc tìm bài tiếng Việt.

## Kiểm tra

```powershell
npm run typecheck
npm run test
npm run build
```

Để áp dụng cho phòng khám về sau, thay bộ dữ liệu bằng **nội dung được duyệt**, giữ giao diện API tìm kiếm, thêm kiểm soát quyền và đánh giá trên truy vấn tiếng Việt. Việc tích hợp vào Gateway/Clinic Service cần một quyết định kiến trúc riêng; demo này chưa sửa các service hiện tại.
