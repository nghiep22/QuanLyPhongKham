# Giao diện tìm kiếm nội dung

Frontend React + Vite + TypeScript cho Project 02. Có ba màn hình: giới thiệu/phạm vi, tìm kiếm, dashboard đánh giá và model card.

## Chạy

Tạo model Python trong `be/HocMayBE` bằng `.venv/Scripts/python.exe chaylenh.py toanbo` rồi khởi động API bằng `.venv/Scripts/python.exe maychu.py` ở cổng 4003. Sau đó:

```powershell
cd fe/HocMayFE
npm ci
npm run dev
```

Mở `http://localhost:5175`. Vite chuyển tiếp `/api` đến backend. Giao diện hiển thị thông báo nếu mô hình chưa được tạo, truy vấn sai hoặc không có kết quả. `npm run build` kiểm tra TypeScript và tạo bản phát hành trong `dist/`.

Các file và biến do dự án đặt dùng tiếng Việt không dấu viết liền. Thuộc tính giao thức HTTP (`q`, `k`, `category`, các khóa JSON) giữ cố định để API Python và React giao tiếp; `src/giaotiep.ts` chuyển chúng sang tên biến nội bộ tiếng Việt.

Khi triển khai giao diện trên máy chủ khác backend, đặt `VITE_API_BASE_URL` thành origin của HocMayBE (ví dụ `https://api.example.com`) lúc build. Nếu để trống, giao diện gọi `/api` cùng origin; máy chủ cần chuyển tiếp đường dẫn đó đến HocMayBE. `npm run preview` cũng chuyển tiếp `/api` đến cổng 4003 để kiểm tra bản build tại máy.
