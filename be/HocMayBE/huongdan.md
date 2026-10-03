# Công cụ tìm kiếm bài viết theo nội dung

Backend Python cho Project 02 của đề học máy. Dữ liệu 20 Newsgroups; mô hình TF–IDF word n-gram, xếp hạng cosine. Ứng dụng học máy tách khỏi nghiệp vụ phòng khám.

## Chạy từ máy mới

Yêu cầu Python 3.12. Tại `be/HocMayBE`:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r thuvien.txt
.\.venv\Scripts\python.exe chaylenh.py toanbo
.\.venv\Scripts\python.exe maychu.py
```

Lần đầu, `chuanbi` dùng `fetch_20newsgroups` của scikit-learn và cần mạng. Tài liệu gốc không được đưa vào Git. Có thể chạy từng bước `chuanbi`, `huanluyen`, `danhgia` riêng. `huanluyen` lưu Pipeline và ma trận sparse bằng joblib. API chỉ đọc model đã lưu, không fit khi nhận request.

Frontend React ở `fe/HocMayFE`: chạy `npm ci`, `npm run dev`; mở `http://localhost:5175`. API chạy trên `http://127.0.0.1:4003`; Vite chuyển `/api` tới API.

## Quy trình và rò rỉ dữ liệu

- Dùng 8 chủ đề cố định và split train/test by-date chính thức. Trước khi học từ vựng, tách 20% train gốc thành validation theo chủ đề bằng seed 42.
- Dùng `remove=('headers','footers','quotes')`, che email, URL, số điện thoại, loại bài quá ngắn và trùng lặp xuyên split. `dulieu/xuly/chatluong.json` liệt kê mọi bài bị loại và lý do.
- EDA độ dài/chủ đề chỉ tính trên train. Tất cả `TfidfVectorizer.fit` chỉ nhận train, cả model phục vụ cuối.
- Baseline là số từ truy vấn khác nhau xuất hiện trong bài. Bốn cấu hình TF–IDF dùng cùng split và cùng metric. Chọn bằng Precision@5 trên validation, rồi MRR để phá hòa. 32 truy vấn tự xây được báo riêng. Test by-date chỉ đo cuối một lần; đánh giá lưu dấu vân tay để dùng lại kết quả khi chạy lại không đổi dữ liệu/model.
- Đầu ra có Precision@5, MRR@10, thời gian tìm kiếm, phân tích lỗi theo chủ đề, ma trận nhầm lẫn và biểu đồ. Relevance tự động là cùng chủ đề, chỉ là proxy; điểm cosine không là xác suất đúng.

## API

`GET /api/search?q=space%20shuttle&k=5&category=sci.space`

```json
{"data":[{"id":"huanluyen/sci.space/12345","category":"sci.space","score":0.42,"snippet":"...","contributingTerms":[{"term":"space","contribution":0.12}]}],"meta":{"query":"space shuttle","k":5,"category":"sci.space","count":1,"responseMs":2.3,"warning":null}}
```

`q` dài 2–200 ký tự; `k` là số nguyên 1–50; `category` phải là chủ đề đã lập chỉ mục. Sai đầu vào hoặc chủ đề trả 400; thiếu model hoặc đánh giá trả 503; endpoint lạ trả 404. Các endpoint khác: `/api/meta`, `/api/evaluation`, `/api/health`. FastAPI cung cấp `/docs` với schema.

## Kiểm tra

```powershell
.\.venv\Scripts\python.exe -m pytest -q kiemthu/kiemthutimkiem.py
```

## Tệp bàn giao

`dulieu/huongdan.md` có nguồn, nguồn gốc và data dictionary. `baocao/` gồm `ketqua.json`, `xacthuc.json`, `themohinh.md`, hình, báo cáo DOCX/PDF và trình bày. Nhật ký, tên hai thành viên, bằng chứng Git và kê khai AI cần nhóm điền dựa trên công việc thực tế trước khi nộp.
