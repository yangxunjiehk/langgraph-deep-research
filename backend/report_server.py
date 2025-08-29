#!/usr/bin/env python3
"""
简单的研究报告存储API服务器
使用FastAPI + MySQL
"""
import pymysql
import json
import re
from datetime import datetime
from typing import List, Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


# 数据模型
class ReportCreate(BaseModel):
    title: str = ""  # 如果为空，从content中提取
    content: str
    query: str
    research_time: int = 0
    metadata: dict = {}


class ReportResponse(BaseModel):
    id: int
    title: str
    query: str
    created_at: str
    status: str
    word_count: int
    research_time: int


class ReportDetail(BaseModel):
    id: int
    title: str
    content: str
    query: str
    created_at: str
    updated_at: str
    status: str
    word_count: int
    research_time: int
    metadata: dict


# FastAPI应用
app = FastAPI(title="Research Reports API", version="1.0.0")

# 添加CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5176", "http://localhost:5177", "http://localhost:5178", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MySQL数据库配置
DB_CONFIG = {
    'host': 'localhost',
    'port': 3306,
    'user': 'root',
    'password': 'root',
    'database': 'deep_research',
    'charset': 'utf8mb4',
    'autocommit': True
}


def get_db_connection():
    """获取数据库连接"""
    return pymysql.connect(**DB_CONFIG)


def init_database():
    """初始化数据库（MySQL表已存在，无需创建）"""
    try:
        conn = get_db_connection()
        conn.close()
        print("MySQL database connection successful")
    except Exception as e:
        print(f"MySQL connection failed: {e}")
        raise


def extract_title_from_content(content: str) -> str:
    """从markdown内容中提取标题"""
    lines = content.split('\n')
    for line in lines:
        line = line.strip()
        if line.startswith('# '):
            return line[2:].strip()
    
    # 如果没有找到标题，使用前50个字符
    text_content = re.sub(r'[#*`_\-\[\]()]', '', content)
    text_content = ' '.join(text_content.split())
    return text_content[:50] + ('...' if len(text_content) > 50 else '')


def count_words(content: str) -> int:
    """计算内容字数"""
    # 移除markdown标记并计算字数
    text = re.sub(r'[#*`_\-\[\]()]', '', content)
    text = re.sub(r'\s+', ' ', text)
    return len(text.strip())


@app.on_event("startup")
async def startup_event():
    """应用启动时初始化数据库"""
    init_database()


@app.get("/api/reports/", response_model=List[ReportResponse])
async def list_reports(limit: int = 50, offset: int = 0):
    """获取报告列表"""
    conn = get_db_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cursor:
            cursor.execute(
                """SELECT id, title, query, created_at, status, word_count, research_time 
                   FROM research_reports 
                   ORDER BY created_at DESC 
                   LIMIT %s OFFSET %s""",
                (limit, offset)
            )
            rows = cursor.fetchall()
            reports = []
            for row in rows:
                # 转换datetime为字符串
                row['created_at'] = row['created_at'].strftime('%Y-%m-%d %H:%M:%S') if row['created_at'] else ''
                reports.append(ReportResponse(**row))
            return reports
    finally:
        conn.close()


@app.post("/api/reports/", response_model=ReportResponse)
async def create_report(report_data: ReportCreate):
    """创建新报告"""
    # 如果没有提供标题，从内容中提取
    title = report_data.title.strip() if report_data.title.strip() else extract_title_from_content(report_data.content)
    
    # 计算字数
    word_count = count_words(report_data.content)
    
    # 将metadata转换为JSON字符串
    metadata_json = json.dumps(report_data.metadata, ensure_ascii=False)
    
    conn = get_db_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cursor:
            cursor.execute(
                """INSERT INTO research_reports 
                   (title, content, query, word_count, research_time, metadata) 
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (title, report_data.content, report_data.query, word_count, report_data.research_time, metadata_json)
            )
            report_id = cursor.lastrowid
            
            # 获取创建的报告信息
            cursor.execute(
                """SELECT id, title, query, created_at, status, word_count, research_time 
                   FROM research_reports WHERE id = %s""",
                (report_id,)
            )
            row = cursor.fetchone()
            # 转换datetime为字符串
            row['created_at'] = row['created_at'].strftime('%Y-%m-%d %H:%M:%S') if row['created_at'] else ''
            return ReportResponse(**row)
    finally:
        conn.close()


@app.get("/api/reports/{report_id}", response_model=ReportDetail)
async def get_report(report_id: int):
    """获取单个报告详情"""
    conn = get_db_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cursor:
            cursor.execute(
                """SELECT * FROM research_reports WHERE id = %s""",
                (report_id,)
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Report not found")
            
            # 解析metadata
            metadata = {}
            try:
                if row['metadata']:
                    metadata = json.loads(row['metadata'])
            except:
                pass
            
            # 转换datetime为字符串
            row['created_at'] = row['created_at'].strftime('%Y-%m-%d %H:%M:%S') if row['created_at'] else ''
            row['updated_at'] = row['updated_at'].strftime('%Y-%m-%d %H:%M:%S') if row['updated_at'] else ''
            
            return ReportDetail(
                id=row['id'],
                title=row['title'],
                content=row['content'],
                query=row['query'],
                created_at=row['created_at'],
                updated_at=row['updated_at'],
                status=row['status'],
                word_count=row['word_count'],
                research_time=row['research_time'],
                metadata=metadata
            )
    finally:
        conn.close()


@app.delete("/api/reports/{report_id}")
async def delete_report(report_id: int):
    """删除报告"""
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("DELETE FROM research_reports WHERE id = %s", (report_id,))
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Report not found")
            return {"message": "Report deleted successfully"}
    finally:
        conn.close()


@app.get("/")
async def root():
    return {"message": "Research Reports API Server", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn
    print("Starting Research Reports API Server on http://localhost:2025")
    print("API Documentation available at http://localhost:2025/docs")
    uvicorn.run(app, host="127.0.0.1", port=2025, log_level="info")