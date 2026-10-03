"""Khởi động máy chủ API ở cổng 4003."""
import os as hedieuhanh
import uvicorn as maychuapi

if __name__ == "__main__":
    maychuapi.run("ungdung:ungdung", host="127.0.0.1",
                  port=int(hedieuhanh.getenv("PORT", "4003")))
