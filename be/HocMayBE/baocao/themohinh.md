# Thẻ mô hình

- Phương pháp: TF–IDF word n-gram, cosine, chuẩn hóa L2.
- Cấu hình chọn: unigram `{'minDf': 3, 'maxDf': 0.95, 'ngramMax': 1}`.
- Chỉ fit train: 3575 bài, 11858 token.
- Validation: chọn bằng Precision@5 rồi MRR@10; 32 truy vấn tự xây báo riêng.
- Test by-date (200 truy vấn): Precision@5 0.457, MRR@10 0.665.
- Baseline test: Precision@5 0.274, MRR@10 0.491.
- Giới hạn: nhãn chủ đề chỉ là proxy liên quan; dữ liệu tiếng Anh cũ; cosine không là xác suất và không đủ làm tư vấn y tế.
- An toàn: bỏ header/footer/quote và che email, URL, số điện thoại.
