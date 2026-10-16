import os

import pandas as pd
import pytest

os.environ['SUPABASE_URL'] = 'https://example.supabase.co'
os.environ['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key'


@pytest.fixture
def cabecera_df() -> pd.DataFrame:
  return pd.DataFrame(
    [
      {
        'Bien_Tipo_Id': '6', 'Cuenta': '1001', 'Identificador': 'AG-1001',
        'Bien_Descripcion': 'Conexion de agua', 'Estado': 'Activo',
        'Destinatario_Id': '501', 'Destinatario_CUIT': '20-12345678-9',
        'Destinatario': 'Ana Perez', 'Destinatario_Porcentaje': '100',
        'Destinatario_Tipo': 'Responsable', 'Destinatario_Telefono': '3415550000',
        'Destinatario_Celular': '', 'Destinatario_Email': 'ANA@EXAMPLE.COM',
        'Destinatario_Provincia': 'santa fe', 'Destinatario_Localidad': 'rosario',
        'Destinatario_CP': '2000', 'Destinatario_Calle': 'Calle Uno',
        'Destinatario_Numeracion': '123', 'Destinatario_Piso': '',
        'Destinatario_Depto': '', 'ClaveAgrupacion': 'AG-1',
        'Tipo_Ingreso_Id': '801', 'Fecha_Actualizacion': '10/01/2025',
      },
      {
        'Bien_Tipo_Id': '1', 'Cuenta': '2001', 'Identificador': 'IN-2001',
        'Bien_Descripcion': 'Inmueble', 'Estado': 'Activo',
        'Destinatario_Id': '502', 'Destinatario_CUIT': '30-98765432-1',
        'Destinatario': 'Empresa Dos', 'Destinatario_Porcentaje': '100',
        'Destinatario_Tipo': 'Titular', 'Destinatario_Telefono': '',
        'Destinatario_Celular': '', 'Destinatario_Email': '',
        'Destinatario_Provincia': '', 'Destinatario_Localidad': '',
        'Destinatario_CP': '', 'Destinatario_Calle': '',
        'Destinatario_Numeracion': '', 'Destinatario_Piso': '',
        'Destinatario_Depto': '', 'ClaveAgrupacion': 'IN-1',
        'Tipo_Ingreso_Id': '1', 'Fecha_Actualizacion': '11/01/2025',
      },
    ]
  )


@pytest.fixture
def detalle_df() -> pd.DataFrame:
  return pd.DataFrame(
    [
      {
        'Bien_Tipo_Id': '6', 'Cuenta': '1001', 'DEUD_id': '9001',
        'NOTD_capital': '1.000,50', 'NOTD_totalActualizado': '1.200,75',
        'NOTD_vencimiento': '01/01/2020', 'Tipo_Ingreso_Id': '801',
        'ClaveAgrupacion': 'AG-1',
      },
      {
        'Bien_Tipo_Id': '6', 'Cuenta': '1001', 'DEUD_id': '9001',
        'NOTD_capital': '1.000,50', 'NOTD_totalActualizado': '1.200,75',
        'NOTD_vencimiento': '01/01/2020', 'Tipo_Ingreso_Id': '801',
        'ClaveAgrupacion': 'AG-1',
      },
      {
        'Bien_Tipo_Id': '1', 'Cuenta': '2001', 'DEUD_id': '9001',
        'NOTD_capital': '500', 'NOTD_totalActualizado': '600',
        'NOTD_vencimiento': '01/01/2999', 'Tipo_Ingreso_Id': '1',
        'ClaveAgrupacion': 'IN-1',
      },
    ]
  )
