"""Các bước offline: chuẩn bị, huấn luyện, đánh giá, hoặc toàn bộ."""
import sys as hethong
from dulieu import chuanbi

if hasattr(hethong.stdout, "reconfigure"):
    hethong.stdout.reconfigure(encoding="utf-8")


def chay():
    lenh = hethong.argv[1] if len(hethong.argv) > 1 else ""
    if lenh == "chuanbi":
        chuanbi()
    elif lenh == "huanluyen":
        from thunghiem import huanluyen
        huanluyen()
    elif lenh == "danhgia":
        from thunghiem import danhgia
        danhgia()
    elif lenh == "toanbo":
        from thunghiem import huanluyen, danhgia
        chuanbi()
        huanluyen()
        danhgia()
    else:
        raise SystemExit("Dùng: python chaylenh.py chuanbi|huanluyen|danhgia|toanbo")


if __name__ == "__main__":
    chay()
