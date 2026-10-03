"""Đường dẫn tương đối với dự án, dùng được trên máy khác."""
from pathlib import Path as duongdan

thumucgoc = duongdan(__file__).resolve().parent
thumucdulieu = thumucgoc / "dulieu"
thumuctho = thumucdulieu / "tho"
thumucxuly = thumucdulieu / "xuly"
thumucmohinh = thumucgoc / "mohinh"
thumucbaocao = thumucgoc / "baocao"
thumuchinh = thumucbaocao / "hinh"
tepchiatap = thumucxuly / "chiatap.json"
tepchatluong = thumucxuly / "chatluong.json"
tepmohinh = thumucmohinh / "botimkiem.joblib"
tepthamso = thumucmohinh / "thamso.json"
tepketqua = thumucbaocao / "ketqua.json"
tepxacthuc = thumucbaocao / "xacthuc.json"
teptruyvan = thumucdulieu / "truyvantutao.json"
