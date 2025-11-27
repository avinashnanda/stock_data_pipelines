from db.db_schema import (
    get_connection,
    init_schema,
)


if __name__=="__main__":
    con = get_connection()
    init_schema(con)