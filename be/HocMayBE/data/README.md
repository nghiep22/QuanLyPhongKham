# Dữ liệu 20 Newsgroups

Pipeline dùng bản **20news-bydate** mà mã nguồn scikit-learn tải từ Figshare. Do yêu cầu của dự án này là TypeScript, script `src/data.ts` tải trực tiếp đúng tệp lưu trữ và kiểm tra SHA-256 theo metadata của scikit-learn. Không cần Python.

- Nguồn mô tả: https://scikit-learn.org/stable/datasets/real_world.html#the-20-newsgroups-text-dataset
- Mã nguồn loader và checksum: https://github.com/scikit-learn/scikit-learn/blob/main/sklearn/datasets/_twenty_newsgroups.py
- URL lưu trữ: https://ndownloader.figshare.com/files/5975967
- SHA-256 kỳ vọng: `8f1b2514ca22a5ade8fbb9cfa5727df95fa587f4c87b786e15c759fa66d95610`
- Ngày chuẩn bị bản thử nghiệm: 2026-09-24.
- Tổng bộ dữ liệu gốc: 18.846 bài, 20 nhóm. Bài tập này chọn 8 nhóm được khai báo cố định trong `src/data.ts`.

Không đưa bản gốc hoặc các bài đăng cá nhân vào Git. Trước khi công bố nội dung, cần kiểm tra điều khoản của nguồn gốc và rà soát nội dung có thể nhận dạng hoặc không phù hợp. Dữ liệu này dành cho thí nghiệm, không phải dữ liệu y khoa phòng khám.

## Tái tạo

Từ `be/HocMayBE`, chạy `npm install` rồi `npm run data:prepare`. Script tải tệp 14 MB, kiểm tra checksum, giải nén, bỏ header, trích dẫn, email, liên kết và chữ ký, sau đó tách dữ liệu. `data/raw` và `data/processed` được bỏ khỏi Git. `data/processed/quality.json` ghi số dòng theo split/chủ đề cùng lý do loại.

Train/test giữ nguyên cách chia **theo ngày** của bộ dữ liệu. Validation được lấy 20% từ train, tách theo từng chủ đề với seed 42. Sau khi chia, pipeline loại bài quá ngắn và bản sao trùng nội dung xuyên split. Vectorizer chỉ học từ tập train khi chọn mô hình. Sau khi chốt cấu hình, mô hình phục vụ được fit lại trên train + validation; test chỉ được dùng để báo cáo cuối.

## Data dictionary

| Trường | Kiểu | Vai trò | Có sẵn khi nào |
|---|---|---|---|
| `id` | string | ID bài đăng, gồm split gốc / chủ đề / tên tệp | Khi đọc tệp |
| `category` | string | Nhãn chủ đề; chỉ dùng để đánh giá | Khi đọc thư mục nguồn |
| `text` | string | Nội dung bài đã làm sạch, feature | Sau tiền xử lý xác định trước |
| `split` | `train` / `validation` / `test` | Phân chia đánh giá | Trước khi học từ vựng |

Đơn vị quan sát là **một bài đăng**. Bài viết bị loại nếu phần nội dung còn dưới 40 ký tự hoặc trùng với bài được giữ ở split trước. Báo cáo chất lượng thực tế được sinh ra sau mỗi lần chạy.

## Truy vấn tự xây

`manual-queries.json` chứa 32 truy vấn ngắn do nhóm biên soạn trước khi xem test. Mỗi truy vấn có nhãn chủ đề liên quan. Nhãn này chỉ là **proxy mức chủ đề**, không chứng minh mọi bài trong chủ đề đều trả lời chính xác câu hỏi. Nên bổ sung đánh giá thủ công mức từng bài nếu triển khai thực tế.
