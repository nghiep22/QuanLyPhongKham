# Dữ liệu 20 Newsgroups

Nguồn: [trang dữ liệu scikit-learn](https://scikit-learn.org/stable/datasets/real_world.html#the-20-newsgroups-text-dataset), [hàm tải](https://scikit-learn.org/stable/modules/generated/sklearn.datasets.fetch_20newsgroups.html), [mô tả trích đặc trưng](https://scikit-learn.org/stable/modules/feature_extraction.html#text-feature-extraction). Bộ gốc có 18.846 bài và 20 nhóm; dự án chọn cố định 8 nhóm trong `dulieu.py`. Dữ liệu đã được tải thử trong dự án ngày 24/09/2026; lần chạy Python sẽ ghi ngày tải/chạy và phiên bản sklearn vào `xuly/chatluong.json`. Loader sklearn lưu dữ liệu gốc trong `dulieu/tho` và kiểm tra checksum của gói tải theo mã nguồn thư viện. Chỉ có script và truy vấn tự xây được đưa vào Git; nội dung bài đăng không được commit. Nội dung 20 Newsgroups công khai để nghiên cứu; trước khi phát hành web công khai, cần rà soát điều khoản nguồn và bài viết có thể chứa nội dung không phù hợp.

## Tái tạo

Chạy `python chaylenh.py chuanbi` từ `be/HocMayBE`. Loader dùng `remove=('headers','footers','quotes')`; sau đó che email, liên kết và số điện thoại. Train/test giữ split by-date của nguồn; validation được tách phân tầng 20% từ train gốc, seed 42. Bài dưới 40 ký tự và bản trùng lặp nội dung qua các split bị loại. `xuly/chatluong.json` ghi số bài từng split/chủ đề, mô tả độ dài chỉ trên train, và ID/lý do từng bài bị loại. `xuly/chiatap.json` tái tạo lại split, không đưa vào Git.

## Data dictionary

| Trường | Kiểu | Vai trò | Có sẵn khi nào |
| --- | --- | --- | --- |
| `madinhdanh` | string | Khóa bài, gồm split gốc/chủ đề/tên tệp | Khi loader đọc nguồn |
| `chude` | string | Nhãn chỉ dùng chia và đánh giá | Khi loader đọc nguồn |
| `noidung` | string | Feature văn bản đã làm sạch | Sau bước làm sạch cố định |
| `tap` | `huanluyen` / `xacthuc` / `kiemthu` | Split đánh giá | Trước mọi bước fit |

Đơn vị quan sát là một bài đăng. Không có phép đo số với đơn vị vật lý; độ dài thống kê có đơn vị ký tự. Từ vựng/IDF fit trên `huanluyen` duy nhất. Bộ `dulieu/truyvantutao.json` gồm 32 truy vấn và nhãn chủ đề được tự xây, báo riêng với truy vấn validation/test. Nhãn chủ đề là proxy liên quan, không chứng minh từng bài trả lời truy vấn.
