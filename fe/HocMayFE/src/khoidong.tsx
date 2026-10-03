import { createElement as taophantu, StrictMode as chedonghiemngat } from 'react';
import { createRoot as taogoc } from 'react-dom/client';
import { ungdung } from './ungdung';
import './giaodien.css';

const phantugoc = document.getElementById('goc');
if (!phantugoc) throw new Error('Không tìm thấy phần tử để khởi động giao diện.');
taogoc(phantugoc).render(taophantu(chedonghiemngat, null, taophantu(ungdung)));
