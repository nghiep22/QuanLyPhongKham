# Giao diện tìm kiếm nội dung

Frontend React + Vite + TypeScript cho Project 02. Có ba màn hình: giới thiệu/phạm vi, tìm kiếm, dashboard đánh giá và model card.

## Chạy

Khởi động `be/HocMayBE` ở cổng 4003, sau đó:

```powershell
cd fe/HocMayFE
npm ci
npm run dev
```

Mở `http://localhost:5175`. Vite chuyển tiếp `/api` đến backend. Giao diện hiển thị thông báo nếu mô hình chưa được tạo, truy vấn sai hoặc không có kết quả. `npm run build` kiểm tra TypeScript và tạo bản phát hành trong `dist/`.

Khi triển khai giao diện trên máy chủ khác backend, đặt `VITE_API_BASE_URL` thành origin của HocMayBE (ví dụ `https://api.example.com`) lúc build. Nếu để trống, giao diện gọi `/api` cùng origin; máy chủ cần chuyển tiếp đường dẫn đó đến HocMayBE. `npm run preview` cũng chuyển tiếp `/api` đến cổng 4003 để kiểm tra bản build tại máy.
