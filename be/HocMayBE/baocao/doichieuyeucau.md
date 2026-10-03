# Đối chiếu Project 02 với sản phẩm

| Yêu cầu trong đề | Bằng chứng trong dự án |
| --- | --- |
| 20 Newsgroups, 6–10 chủ đề, bỏ headers/footers/quotes | `dulieu.py` dùng `fetch_20newsgroups` với 8 chủ đề và `remove=('headers','footers','quotes')`; nguồn và dictionary tại `dulieu/huongdan.md` |
| Có script tái tạo, không đưa dữ liệu lớn vào Git | `chaylenh.py chuanbi`; `dulieu/tho` và `dulieu/xuly` được ignore |
| Báo chất lượng và mọi dòng bị loại | `dulieu/xuly/chatluong.json`: 7.801 bài đầu vào, 353 quá ngắn, 24 trùng, 7.424 giữ lại; có ID/lý do từng bài bị loại |
| Split trước khi fit, train/validation/test độc lập | Train/test by-date của nguồn; validation phân tầng 20% từ train gốc, seed 42; `timkiem.taomohinh` từ chối bản ghi ngoài train |
| EDA trên train | `baocao/hinh/phanbohuanluyen.svg` và biểu đồ trong báo cáo; quyết định giữ phân tầng, không nhân bản lớp |
| Baseline và bốn cấu hình TF–IDF | `thunghiem.py`, `baocao/xacthuc.json`; cùng 200 truy vấn validation và cùng P@5/MRR@10 |
| Ít nhất 30 truy vấn tự xây | `dulieu/truyvantutao.json`: 32 truy vấn có chủ đề liên quan; kết quả manual tách riêng trong `baocao/ketqua.json` |
| Test chỉ báo cáo cuối | `chaylenh.py danhgia` đo 200 truy vấn test sau chọn cấu hình; dấu vân tay trong `mohinh/thamso.json` giúp dùng lại kết quả cũ nếu chạy lặp |
| Lưu Pipeline, model card, số liệu, biểu đồ | `mohinh/botimkiem.joblib` (artifact tạo local), `baocao/themohinh.md`, `baocao/ketqua.json`, `baocao/hinh/` |
| API có validation và lỗi hợp lý | FastAPI `GET /api/search?q=&k=&category=`, `/api/meta`, `/api/evaluation`, `/api/health`; kiểm thử 200/400/404/503 tại `kiemthu/kiemthutimkiem.py` |
| Web ba màn hình, bộ lọc, đoạn trích, thời gian | React tại `fe/HocMayFE`: giới thiệu/phạm vi, tìm kiếm, dashboard và model card |
| Báo cáo 15–25 trang và trình bày 10–12 slide | `baocaotfidf.docx`/`.pdf` 17 trang; `trinhbaytfidf.pptx` 11 slide; dùng số đo Python ngày 02/10/2026 |
| Nhật ký, bằng chứng hai thành viên, khai báo AI | Mẫu `nhatkyphancong.md`; nhóm điền tên, mã số, giờ, commit/PR và công cụ thực tế trước khi nộp |

Đánh giá độ liên quan của 32 truy vấn tự xây hiện dùng **chủ đề** làm nhãn proxy, không phải danh sách bài được chấm thủ công. Báo cáo nêu rõ giới hạn này. Bài `sci.med` thuộc diễn đàn lịch sử, không phải tài liệu y khoa được duyệt. Điểm cosine biểu thị độ giống từ vựng, không phải xác suất đúng.
