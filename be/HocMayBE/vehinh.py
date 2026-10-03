"""Biểu đồ SVG tạo từ số liệu đã đo."""
from html import escape as thoathtml

from duongdan import thumuchinh


def phanbo(banghuanluyen: dict[str, int]) -> None:
    thumuchinh.mkdir(parents=True, exist_ok=True)
    dong = []
    for vitri, (chude, soluong) in enumerate(sorted(banghuanluyen.items())):
        tungdo = 58 + vitri * 44
        dong.append(f'<text x="18" y="{tungdo}" font-size="13">{thoathtml(chude)}</text>'
                    f'<rect x="235" y="{tungdo-16}" width="{soluong}" height="23" fill="#19846e"/>'
                    f'<text x="{245+soluong}" y="{tungdo}" font-size="13">{soluong}</text>')
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="{90+44*len(dong)}"><rect width="100%" height="100%" fill="white"/><text x="18" y="27" font-size="19">Phân bố chủ đề chỉ trên tập huấn luyện (bài)</text>{"".join(dong)}</svg>'
    (thumuchinh / "phanbohuanluyen.svg").write_text(svg, encoding="utf-8")


def xacthuc(thunghiem: list[dict]) -> None:
    thumuchinh.mkdir(parents=True, exist_ok=True)
    dong = []
    for vitri, muc in enumerate(thunghiem):
        tungdo = 58 + vitri * 48
        chieurong = round(muc["validation"]["precisionAt5"] * 480)
        dong.append(f'<text x="18" y="{tungdo}" font-size="13">{thoathtml(muc["name"])}</text>'
                    f'<rect x="260" y="{tungdo-17}" width="{chieurong}" height="25" fill="#19846e"/>'
                    f'<text x="{272+chieurong}" y="{tungdo}" font-size="13">{muc["validation"]["precisionAt5"]:.3f}</text>')
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="850" height="{95+48*len(dong)}"><rect width="100%" height="100%" fill="white"/><text x="18" y="28" font-size="19">Validation Precision@5</text>{"".join(dong)}</svg>'
    (thumuchinh / "doxacthuc.svg").write_text(svg, encoding="utf-8")


def nhamlan(chiso: dict, chude: list[str]) -> None:
    thumuchinh.mkdir(parents=True, exist_ok=True)
    kichthuoc = 36
    ben = 190
    tren = 130
    o = []
    for hang, thucte in enumerate(chude):
        o.append(f'<text x="8" y="{tren+hang*kichthuoc+23}" font-size="12">{thoathtml(thucte)}</text>')
        for cot, dudoan in enumerate(chude):
            dem = chiso["confusion"].get(thucte, {}).get(dudoan, 0)
            dam = min(0.9, 0.12 + dem / 25)
            o.append(f'<rect x="{ben+cot*kichthuoc}" y="{tren+hang*kichthuoc}" width="{kichthuoc-2}" height="{kichthuoc-2}" fill="#19846e" fill-opacity="{dam:.2f}"/><text x="{ben+cot*kichthuoc+14}" y="{tren+hang*kichthuoc+21}" font-size="11">{dem}</text>')
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="700" height="{tren+kichthuoc*len(chude)+25}"><rect width="100%" height="100%" fill="white"/><text x="8" y="27" font-size="19">Test: chủ đề kết quả đầu tiên</text><text x="8" y="48" font-size="12">Hàng: chủ đề đúng; cột: chủ đề kết quả top 1, thứ tự từ trái qua phải: {thoathtml(", ".join(chude))}</text>{"".join(o)}</svg>'
    (thumuchinh / "matrannhamlan.svg").write_text(svg, encoding="utf-8")
